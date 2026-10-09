# Feature: v0.1-m1-core

Status: done, ready for review | Branch: feat/v0.1-m1-core

## Goal

v0.1 milestone M1 (issues #18, #19, #20, #71): modules are validated data (manifest schema and loader), the project config and presets resolve deterministically, templates render byte-identically on every OS and for any brand, and `THIRD_PARTY_LICENSES.md` comes from the bundler's module graph now that zod is the first inlined package. Done means every acceptance criterion in the four issues holds and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-10: Start from the issue texts, the #19 comment and ADR-0014/0015/0016/0007/0012; where an issue and an ADR differ, the ADR wins. Why: the milestone brief and the roadmap.
- 2026-10-10: The license list comes from each build's whole module graph (`this.getModuleIds()` in a rolldown plugin in `tsdown.config.mts`), not from `chunk.moduleIds` (#71). Why: a test showed rolldown folding a package's constant into another module and dropping it from `moduleIds` (and from the `//#region` comments), though its code still ships; listing a package that tree-shaking emptied costs nothing, missing one breaks its license.
- 2026-10-10: Each bundle's list is a build asset, `dist/<bundle>.inlined.json`, kept out of the package by a `!dist/**/*.inlined.json` entry in `files`. Why: no build reads or deletes another build's output, so parallel builds cannot race; the license script stays idempotent; the pack snapshot proves the lists never ship.
- 2026-10-10: Lint now refuses `process` (global, `globalThis.process`, the module) and `fs`/`fs/promises` imports in `src/core`, not only `process.exit` and `console`. Why: the brief and #18 ("nothing in src/core uses console or process"); file contents come through an injected reader. Consequence: M2's transactional apply (#24) must take injected file operations or live outside `src/core`.
- 2026-10-10: zod 4 through `zod/mini`. Why: it supports `z.toJSONSchema()`; a probe manifest bundled to 51.9 kB (11.7 kB gzip) with `zod/mini` against 182.3 kB (39.9 kB gzip) with classic `zod`, unminified.
- 2026-10-10: jsonc-parser joins now (it was planned for M2) only to locate JSON syntax errors; values still come from `JSON.parse`. Why: V8 gives no position for `Unexpected token` errors, and every message must name a line; `JSON.parse` keeps a `__proto__` key as data, while jsonc-parser's object building would set the prototype.
- 2026-10-10: Errors read `<file>: <location>: <problem>` plus a `Try: <fix>` line, with `file`, `location` and `hint` fields; the CLI (#26) prints the message as is. A fourth subclass, `ConfigError`, covers `.archkeeper/config.json`. Why: the brief asks every message to name the file, the path or line, and the fix; config problems are neither manifest nor resolution errors.
- 2026-10-10: Manifest file model: `files[]` declares every file a module writes with its strategy and target. `owned` and `create-only` files name a template in `from`; `blocks` and `json` files take no `from` and get their content from `blocks[]` and `gitignore[]`, or from `hooks`/`permissions` (`.claude/settings.json`) and `mcpServers` (`.mcp.json`), the only two json files. Hook scripts are the exception: `hooks[].script` names a bundle under `dist/hooks/`, installed as an owned file in `BRAND.hookDir`. Why: ADR-0014 ("every generated file declares one strategy in its module manifest") and #20 (JSON is built from objects, never from text templates).
- 2026-10-10: `target: plugin` is allowed only for owned files under `.claude/skills/` or `.claude/agents/`. Why: ADR-0016, the plugin carries only skills and agents.
- 2026-10-10 (review): a file written from a template (owned, create-only or blocks) may not target `.claude/settings.json`, `.mcp.json`, `.claude/settings.local.json`, any path with a `.git` segment, or anything under `brand.stateDir` or `brand.hookDir`. The loader checks `to` against `BRAND` and the `{{brand.stateDir}}`/`{{brand.hookDir}}` spellings (`src/core/targets.ts`); `render()` checks the rendered path against the brand it is given. Paths compare after NFC and lower-casing, and the render tree refuses two spellings of one path that differ only that way. Why: an owned `.mcp.json` or settings template skipped every MCP and permission check in the schema (#20: JSON is built from objects), and macOS and Windows file systems would let a `.Claude/Settings.json` template replace the merged settings. #23 still adds the file-system checks (symlinks, `GIT~1`, reserved Windows names) for every write.
- 2026-10-10 (review 2): a target (the `to` of an owned, create-only or blocks file, and the path it renders to) uses only ASCII letters, digits, `.`, `_`, `-`, spaces and `/` (`targetPathProblem`, `targetPath`), and no path name may end in a dot or a space (`relativePathProblem`). Why: macOS folds more than `toLowerCase()` does (a long s, U+017F, reads as `s`), so a template to `.claude/<long s>ettings.json` passed the reserved-target check and the case-clash check and would replace the merged settings; Windows drops a trailing dot or space, so `.git./hooks/pre-commit` and `.mcp.json.` passed too. Refusing other characters is simpler and stronger than a fuller case fold, and it leaves the NFC step of `foldedPath` with no target to fold, so the Unicode-normalisation clash test went. `toImport` still takes any project path, since it writes user paths.
- 2026-10-10: Hooks are a union on `event`: `if` only on PreToolUse and PostToolUse, `once` never, no `command`/`args`/`shell` fields (exec form is generated), a required `timeout` of 1–600 s. Why: ADR-0015 and reference §1.2.
- 2026-10-10 (review): a Stop hook takes no `matcher`. Why: Stop has nothing to match, so Claude Code ignores the field (reference §1.2 example, §1.3); SessionStart (source) and PreCompact keep theirs.
- 2026-10-10: MCP servers: stdio takes `command`, `args` and `env`; http and sse take `url`, `headers` and `headersHelper`. `env` and `headers` values must be exactly `${NAME}`, and URLs may not carry `user:password@`. Why: #18 asks for `${VAR}`-only env and header values (ADR-0007).
- 2026-10-10 (review): remote servers are narrowed further. A URL takes no `#fragment`, and each query value must be a `${NAME}` reference; a remote URL or header may not reference a variable whose name contains TOKEN, SECRET, PASSWORD, KEY or AUTH; `headersHelper` must be a single project script, `${CLAUDE_PROJECT_DIR:-.}/<path>`, with no arguments. Why: a query string carried literal keys past #18's rule; Claude Code reads credential variables as empty in remote url and headers (reference §5.1), so such a server would silently get blank auth, and §11 sends remote auth through OAuth or `headersHelper`; an inline helper is a shell command that can hold a token. A refused pattern value is never echoed in the error, since it can be a pasted token.
- 2026-10-10 (review 2): a module adds no `permissions.allow` rule at all (`noAllowRules` in `src/core/manifest-rules.ts`); `ask` and `deny` are unchanged. This replaces the first review's lint, which refused bare tool names, wildcard-only specifiers and a regex of secret paths. Why: a second review got past that lint with rules that each skip the prompt: `Bash(node:*)`, `Bash(sh -c:*)` and `Bash(npx:*)` (a shell), `Edit(.claude/**)`, `Write(.git/hooks/*)` and `Edit(.husky/**)` (the agent's own guards, or code that runs later), `Read(//etc/**)` and `Read(~/Library/**)` (outside the project), `WebFetch(domain:*)`, and glob or unlisted secret paths such as `Read(**/.en*)` and `*.p12`. No shipped module uses `allow`, so refusing it costs nothing now. The first module that needs one brings a reviewed narrow shape, reusing ADR-0015's wrapper and interpreter list, refusing `Edit`/`Write` on `.claude/`, `.mcp.json`, `.git/`, `.husky/` and the brand folders and specifiers that start with `/`, `//` or `~`, and matching the specifier as a glob against sample secret paths; ADR-0014 already has `update` list every allow rule it adds.
- 2026-10-10: Module options are typed `boolean`, `string` or `string-list`, each with a default and a description; the safety module declares `optOut` (a string list) in its manifest. Why: the ADRs' options (`blockAiAttribution`, `blockNoVerify`, `checks.stop`, `optOut`) need no other type, and options belong to the manifest that owns them, so the config schema stays module-agnostic.
- 2026-10-10: `schema/*.json` are draft-07 JSON Schemas of the input shape, generated by `scripts/build-schemas.mjs` (a Node resolve hook maps `./x.js` imports to `.ts`) and ignored by Prettier. Why: draft-07 has the widest editor support; the generator owns the formatting, so `--check` compares bytes.
- 2026-10-10: `schema/` ships in the npm package (it was already in `files`, ADR-0011). Why: `npx` users have no `node_modules` copy to point at, so `init` (M3) can write a `$schema` URL to the published file of the exact kit version, for example jsDelivr's `npm/<npmName>@<version>/schema/config.schema.json` built from `BRAND`; the editor fetches it, the kit never does (ADR-0018). The two files cost 22 kB unpacked.
- 2026-10-10: The config schema is not strict (no `additionalProperties: false`), and the parser warns about unknown keys at the top level and in `modules` and `compose`; options for an unknown module or option warn too. A wrong option type fails with the option's description. Why: #19 says unknown keys warn and invalid values fail with a hint; a strict JSON Schema would make editors mark as errors what the CLI accepts.
- 2026-10-10: Config shape: `version` (1; a newer one fails with "upgrade"), `$schema`, `preset` (validated against the catalog at resolve time), `modules {add, remove}`, `stack` (a list of `ts`/`python`; empty means none), `options` by module id, and `compose {superpowers, specKit}`, both false by default. Why: ADR-0014 and the #19 comment; `compose` names the ADR-0008 choices after the roadmap's "compose offers".
- 2026-10-10: `modules/presets.json` lists the presets in chain order with a `default` (medium, as #27 says) and `defaults.sessionStartCap`; the loader refuses a module whose `presets` skips a link of the chain. Why: membership comes from each manifest (#19), so the chain is checked rather than inherited.
- 2026-10-10: Resolution adds requirements, refuses a requirement that `modules.remove` drops, leaves out modules whose `when` fails (and anything that requires them, and anything added only for them), refuses conflicts among what is left, and orders by requires with ties broken by id. Errors carry the chain from the preset or `modules.add`. Why: #19's acceptance criteria.
- 2026-10-10: `render()` returns a map from each project path to a list of entries: one for a whole file, one per block for a blocks file, one per module for a json file. Why: several modules write blocks and JSON entries into one file, so a single `{content, strategy, module, blockId?}` per path cannot hold them; owned and create-only paths still have exactly one, and a second writer is a RenderError.
- 2026-10-10: A JSON entry is owned by the key ADR-0014 names (hook: event plus script path; permission: list plus rule; MCP server: name), and two modules adding one key is a RenderError. `$schema` is left to the json strategy (#22). Why: ADR-0014's `ownedKeys`.
- 2026-10-10: `RenderContext` is `{stack, options?, values?}`; `values` holds template variables beside `brand.*` (for example the detected commands table in M3). `gitignore` lines are templated too, for `{{brand.stateDir}}/local/`. Why: the stack and options decide `when`; brand-derived paths must never be written literally (ADR-0012).
- 2026-10-10 (review): `render()` scans every rendered entry with the secret patterns of the repo's guard-secrets hook (`src/core/secrets.ts`) and throws RenderError naming the kind and line, never the value. Why: defence in depth for literals the schema cannot see, such as stdio `command` and `args` or a template value. The list is copied from `.claude/hooks/guard-secrets.mjs`; #32 builds the shipped guard and gives both one list (`src/hooks` may not import `src/core`, so the list would move to `src/hooks/runtime`).
- 2026-10-10: The render snapshot uses the `acmekit` test brand. Why: `check-brand` refuses the real slug in `test/`, and a brand rename then leaves the snapshot unchanged; other tests check the real brand's paths.
- 2026-10-10: The CLI loads the shipped catalog on every run (`src/cli/kit.ts`), reporting a broken manifest as a damaged install. Why: it is the first real use of core, so zod is inlined and measured, and the install smoke on three OSes now proves `modules/` ships and loads from a path with a space.
- 2026-10-10: The frontmatter allowlist stays for M3. Why: it constrains the contents of rendered skill and agent files (ADR-0015's static test over every preset and stack), not the manifest.
- 2026-10-10: No new ADR. Why: every choice above refines ADR-0011, 0014, 0015 or 0016 without changing them; `docs/decisions.md` lists the larger ones.

## Measured sizes (ADR-0017)

| Item                            | Before M1 | After M1                | Budget |
| ------------------------------- | --------- | ----------------------- | ------ |
| `dist/cli.mjs`                  | 5.2 kB    | 124.3 kB (30.3 kB gzip) | none   |
| of which zod (`zod/mini`)       | 0         | 58.8 kB                 |        |
| of which jsonc-parser           | 0         | 24.1 kB                 |        |
| of which `src/core` + `src/cli` | 5.2 kB    | 40.0 kB                 |        |
| Tarball                         | 6.5 kB    | 38.7 kB                 | 300 kB |
| Unpacked                        | 15.7 kB   | 163.0 kB                |        |
| Files in the package            | 5         | 15                      |        |
| Runtime dependencies            | 0         | 0                       | 0      |

Bundle parts are the unminified `//#region` sizes, measured again after the review fixes (the stricter manifest schema and rules and `src/core/targets.ts` added 6.6 kB; `render()` and the secret scan are not in the CLI bundle yet). `THIRD_PARTY_LICENSES.md` lists `jsonc-parser@3.3.1` and `zod@4.6.5`, in name order.

## Demo flips (ROADMAP v0.1 "README and demo")

Every module is `internal: true` until its milestone ships its README section and GIF; that milestone replaces `internal` with `demo`.

| Module           | Demo (GIF)                                                              | Milestone |
| ---------------- | ----------------------------------------------------------------------- | --------- |
| base             | Quick start (`init.gif`, the hero candidate; #28 sets `demo` to `init`) | M3        |
| safety           | Safety (`guard.gif`, live)                                              | M4        |
| feature-memory   | Feature memory (`memory.gif`, live)                                     | M5        |
| knowledge        | Decisions, `/why` and `/adr` (`why.gif`, live)                          | M5        |
| architecture-map | Architecture map (`map.gif`, live)                                      | M6        |
| format-on-edit   | Format on edit (`format.gif`, live)                                     | M6        |
| stop-check       | Tests before done (`stop-check.gif`, live)                              | M6        |

`compose.gif` (M6), `doctor.gif` and `lifecycle.gif` (M7) belong to CLI commands. `check-demos` cannot check commands yet: the command registry arrives with #26 (M3), marked `TODO(#26)` in `scripts/check-demos.mjs`.

## Done

- [x] Feature memory (3eaa00e)
- [x] #71 inlined packages from the bundler's module graph (83fc732)
- [x] Core purity lint for `process` and `fs` (8fb0bd3)
- [x] #18 manifest schema and loader (c6904f3, eb26e37); `schema/module.schema.json` generator and stale check in `npm run check` and CI (3f656fc); demo-or-internal in `check-demos` (4b2cb85)
- [x] #19 project config and options (4d3fe75), resolution (00fce21, d9534f5), the seven manifests and `modules/presets.json` with the membership test (49f941c)
- [x] #20 renderer, `toImport`, snapshot, property and acmekit tests, `.gitattributes` (1b11959)
- [x] CLI loads the catalog, so zod is inlined and measured (74d7f33); brand JSDoc points at ADR-0012 (d1d3658)
- [x] `docs/architecture.md`, `docs/decisions.md`, ROADMAP M1 ticked, changeset. `npm run check` green before every commit.
- [x] Local proofs: two builds in different directories are byte-identical; the packed tarball installs under a path with a space and its bin loads `modules/`; the bundle parses as ES2022, so the Node 18 gate still runs. Plugin root-matching fix for Windows short paths (f2701b2).
- [x] `reviewer` and `security-reviewer` findings answered: template targets for settings, `.mcp.json`, `.git` and kit folders refused (b7d46cd); case-only path clashes and a module writing one path twice (f7504a6); refused pattern values never echoed (8ba0fb1); remote MCP query values, credential variables and `headersHelper` narrowed (345b844); rendered output scanned for secrets (3d36fb1); broad and secret-path allow rules refused (8ee0bb3); conflict hints follow the selection chain (ca29bc7); option value forms named (9091d9b); preset must be an id, request values quoted (166fcf8); fractional config version (05e85cd); inherited option names (b36956b); no `matcher` on Stop (9c6774c); hook script paths checked (0f4cb8c); gitignore negations and rendered lines (138ba59); `toImport` outside the project (58ba89e); `compareText` everywhere (70b3fc8); `readKit` in the modules test (29abe57); one fix for a damaged install (9e7b703); docs nits (c7a5fcb).
- [x] A `/code-review` pass found two low-severity bugs, both fixed with tests: `modules.remove` of a requirement whose module is left out anyway (9e30edf), and `# ` lines in README code blocks read as headings (b3cdf01). The `reviewer` and `security-reviewer` agents ran afterwards (see the next line).

## Next step

Open the M1 PR (closes #18, #19, #20, #71). In the PR body, say that #18's "every CLI command in the command registry declares a demo or is internal" moves to #26 (`TODO(#26)` in `scripts/check-demos.mjs`; #26's acceptance criteria cover it). Before the PR closes #20: get the owner's confirmation of the render tree's list of entries per path and amend #20's text or comment on it, and confirm that the Windows leg of CI runs the render snapshot green. Then start M2 with `/new-feature v0.1-m2-...` (#21–#24); note the purity lint decision above for #24.

## Gotchas / don't try again

- Review finding declined: `scripts/demo-rules.mjs` keeps its own demo-or-internal check rather than importing `manifest-rules.ts`. #18 places the rule in `check-demos`, which reads raw JSON with no build and no zod, reports every module at once, and will check CLI commands too (#26), which the loader never sees; the loader's copy guards every run. Sharing one implementation would make a dependency-free repo script load TypeScript and zod through a resolve hook.
- ESLint's `no-control-regex` refuses `\x00`-style ranges in a regex; use `hasControlCharacter` from `src/core/paths.ts` (as `ignoreLineProblem` does) instead.

- Probe code in a gitignored `tmp/` folder is still linted by `npm run lint` (ESLint does not read `.gitignore`); experiment in the session scratchpad instead.
- A backslash-u escape for the byte-order mark ended up on disk as the invisible character itself, twice; write `String.fromCodePoint(0xfeff)` in code and describe it in words in docs.
- zod metadata belongs to a schema instance: describing a shared schema (such as `kebabId`) describes every use of it. `described()` clones first.
- `dist/` is gitignored at every depth, so test fixtures cannot hold a `dist/hooks/` folder; the render fixture keeps its bundle in `hook-bundles/` and the test reader maps the path.
- The loader reads hook bundles from `dist/hooks/`, which exists only after a build: M4 tests that load real modules with hooks must build first or read through a mapped reader as the render test does.
- A zod upgrade can change the generated `schema/*.json`, so a Dependabot zod bump fails `schema:check` until someone runs `npm run schema` on the branch.
- The CI step for `schema:check` changes `.github/workflows/ci.yml`; pushing it needs the `workflow` scope (`gh auth refresh -h github.com -s workflow`).

## Open questions

- Owner: confirm the decisions above that go past the issue texts, chiefly the render tree's list per path (#20's acceptance criteria still say one `{content, strategy, module, blockId?}` per path, so #20's text needs an amendment or a comment before the PR closes it), `ConfigError`, `compose`, the purity lint's reach into M2, and jsonc-parser arriving in M1.
- `headersHelper`'s runtime (which shell runs it, its working directory, which variables expand in it) is not in reference §1–11, so the schema takes only the narrowest form. Verify it before the first module uses the field, and widen the form only then.
- M3 decides the exact `$schema` URL `init` writes into the config (a versioned CDN URL of the published schema is the proposal).
