import * as z from 'zod/mini';
import { hasControlCharacter } from './paths.js';
import {
  described,
  kebabId,
  listOf,
  oneLine,
  optionName,
  refusing,
  relativePath,
  STACKS,
} from './schema-parts.js';

/** Hook events a module may register (ADR-0015). PreToolUse and PostToolUse are the tool events. */
export const HOOK_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'PreCompact', 'Stop'] as const;
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse'] as const;
const MATCHED_EVENTS = ['SessionStart', 'PreCompact'] as const;

/** The settings file the kit builds from hooks and permissions (ADR-0014). */
export const SETTINGS_FILE = '.claude/settings.json';
/** The project MCP config, built from `mcpServers` (ADR-0007). */
export const MCP_FILE = '.mcp.json';
/** The ignore file that `gitignore` lines go to, in a block named after the module. */
export const GITIGNORE_FILE = '.gitignore';

const GITIGNORE_START = /^[^\s#!]/;
const GITIGNORE_HINT = 'write one ignore pattern, not a comment, a blank line or a ! negation';

/** Says why `line` is not one ignore pattern, or returns undefined; a `!` negation would un-ignore a file. */
export function ignoreLineProblem(line: string): string | undefined {
  if (hasControlCharacter(line)) return 'contains a control character, such as a newline';
  return GITIGNORE_START.test(line) ? undefined : 'is blank, a comment or a ! negation';
}

const when = z.strictObject({
  stack: z.optional(z.array(z.enum(STACKS)).check(z.minLength(1))),
  options: z.optional(z.record(optionName, z.union([z.boolean(), z.string()]))),
});
const whenField = described(
  z.optional(when),
  'Render only when the project stack is one of `stack` and every listed option of this module has its value.',
);

const option = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('boolean'), default: z.boolean(), description: oneLine }),
  z.strictObject({ type: z.literal('string'), default: z.string(), description: oneLine }),
  z.strictObject({ type: z.literal('string-list'), default: z.array(z.string()), description: oneLine }),
]);

const PROJECT_ONLY = 'use project: the plugin carries only owned skills and agents (ADR-0016)';
const NO_FROM =
  'remove from: a blocks or json file gets its content from blocks, gitignore, hooks, permissions or mcpServers';
const projectTarget = z.literal('project', { error: PROJECT_ONLY });
const noFrom = z.optional(z.never({ error: NO_FROM }));
const file = z.discriminatedUnion('strategy', [
  z.strictObject({
    from: relativePath,
    to: relativePath,
    strategy: z.literal('owned'),
    target: z.enum(['project', 'plugin']),
    when: whenField,
  }),
  z.strictObject({
    from: relativePath,
    to: relativePath,
    strategy: z.literal('create-only'),
    target: projectTarget,
    when: whenField,
  }),
  z.strictObject({
    from: noFrom,
    to: relativePath,
    strategy: z.literal('blocks'),
    target: projectTarget,
    when: whenField,
  }),
  z.strictObject({
    from: noFrom,
    to: z.enum([SETTINGS_FILE, MCP_FILE], { error: `json files are ${SETTINGS_FILE} and ${MCP_FILE}` }),
    strategy: z.literal('json'),
    target: projectTarget,
    when: whenField,
  }),
]);

const block = z.strictObject({ file: relativePath, id: kebabId, template: relativePath });

const PERMISSION_RULE = /^[A-Za-z][\w-]*(?:\(.+\))?$/;
const rule = z.string().check(
  z.regex(PERMISSION_RULE, {
    error: 'write a permission rule such as Bash(git push --force:*) or Read(**/.env)',
  }),
);
const SCRIPT_HINT = 'name a bundle under dist/hooks/, such as dist/hooks/guard-bash.mjs (ADR-0015)';
const hookFields = {
  matcher: z.optional(z.string().check(z.minLength(1))),
  script: z
    .string()
    .check(z.regex(/^dist\/hooks\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.mjs$/, { error: SCRIPT_HINT })),
  timeout: z.int().check(z.minimum(1), z.maximum(600)),
  once: z.optional(
    z.never({ error: 'remove once: settings files ignore it; only skill frontmatter honours it' }),
  ),
};
const noIf = z.optional(z.never({ error: 'remove if: a hook with if never runs on a non-tool event' }));
const hook = z.discriminatedUnion('event', [
  z.strictObject({ event: z.enum(TOOL_EVENTS), ...hookFields, if: z.optional(rule) }),
  z.strictObject({ event: z.enum(MATCHED_EVENTS), ...hookFields, if: noIf }),
  z.strictObject({
    event: z.literal('Stop'),
    ...hookFields,
    matcher: z.optional(z.never({ error: 'remove matcher: Stop has none, so Claude Code ignores it' })),
    if: noIf,
  }),
]);

const permissions = z.strictObject({
  allow: z.optional(z.array(rule)),
  ask: z.optional(z.array(rule)),
  deny: z.optional(z.array(rule)),
});

const ENV_HINT =
  'write ${NAME}: values reference an environment variable and never hold a literal value (ADR-0007)';
const REFERENCE = String.raw`\$\{[A-Za-z_][A-Za-z0-9_]*\}`;
const envReference = z.string().check(z.regex(new RegExp(`^${REFERENCE}$`), { error: ENV_HINT }));
const serverName = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/, { error: 'use letters, digits, _ and -' }));
const nonEmpty = z.string().check(z.minLength(1));

// Claude Code reads these variables as empty in a remote url or header (reference §5.1).
const CREDENTIAL_NAME = /TOKEN|SECRET|PASSWORD|KEY|AUTH/i;
const OAUTH_HINT =
  'authenticate the server with OAuth or a headersHelper script: a credential variable reads as empty here';
const noCredentialVariable = refusing((value) => {
  const name = [...value.matchAll(/\$\{([^}]*)\}/g)].find((match) => CREDENTIAL_NAME.test(match[1] ?? ''));
  if (name === undefined) return undefined;
  return { problem: `uses \${${name[1] ?? ''}}, which Claude Code reads as empty`, hint: OAUTH_HINT };
});

const QUERY_PART = String.raw`[^\s=&#]+=${REFERENCE}`;
const URL_SHAPE = String.raw`^https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?(?:\?${QUERY_PART}(?:&${QUERY_PART})*)?$`;
const URL_HINT =
  'use an http(s) URL with no user:password@ and no #fragment, whose query values are ${NAME} references';
const url = z.string().check(z.regex(new RegExp(URL_SHAPE), { error: URL_HINT }), noCredentialVariable);
const remoteReference = envReference.check(noCredentialVariable);
const HELPER_HINT =
  'name a script in the project, such as ${CLAUDE_PROJECT_DIR:-.}/scripts/mcp-headers.sh, with no arguments: ' +
  'it prints the headers, so .mcp.json holds no secret and no command line';
const headersHelper = z
  .string()
  .check(
    z.regex(/^\$\{CLAUDE_PROJECT_DIR:-\.\}(?:\/(?!\.\.?(?:\/|$))[\w.][\w.-]*)+$/, { error: HELPER_HINT }),
  );
const mcpServer = z.discriminatedUnion('type', [
  z.strictObject({
    name: serverName,
    type: z.literal('stdio'),
    command: nonEmpty,
    args: z.optional(z.array(z.string())),
    env: z.optional(z.record(z.string(), envReference)),
  }),
  z.strictObject({
    name: serverName,
    type: z.enum(['http', 'sse']),
    url,
    headers: z.optional(z.record(z.string(), remoteReference)),
    headersHelper: z.optional(headersHelper),
  }),
]);

const DEMO =
  'A user-facing module: docs/media/tapes/<tape>.tape renders docs/media/<tape>.gif for the README section.';

/** The contract of `modules/<id>/module.json`: a module is data (ADR-0003); cross-field rules live in the loader. */
export const moduleManifestSchema = z
  .strictObject({
    $schema: z.optional(z.string()),
    schemaVersion: z.literal(1, { error: 'set schemaVersion to 1' }),
    id: described(kebabId, 'The module folder name.'),
    description: described(oneLine, 'One line that says what the module adds.'),
    requires: listOf(kebabId, 'Modules this one needs; resolution adds them.'),
    conflicts: listOf(kebabId, 'Modules that cannot be enabled together with this one.'),
    presets: listOf(kebabId, 'Presets that include this module; each preset contains the one before it.'),
    when: whenField,
    files: listOf(
      file,
      'Every file the module writes, with its ownership strategy and target (ADR-0014, ADR-0016).',
    ),
    blocks: listOf(
      block,
      'Managed blocks rendered from templates into files declared with the blocks strategy.',
    ),
    hooks: listOf(hook, 'Hooks registered in exec form in .claude/settings.json (ADR-0015).'),
    permissions: described(z._default(permissions, {}), 'Permission rules added to .claude/settings.json.'),
    gitignore: listOf(
      z.string().check(
        z.regex(GITIGNORE_START, { error: GITIGNORE_HINT }),
        refusing((line) => {
          const problem = ignoreLineProblem(line);
          return problem === undefined ? undefined : { problem, hint: GITIGNORE_HINT };
        }),
      ),
      'Lines for a .gitignore block named after the module.',
    ),
    options: described(
      z._default(z.record(optionName, option), {}),
      'Options users set in the project config, with typed defaults.',
    ),
    mcpServers: listOf(
      mcpServer,
      'MCP servers written to .mcp.json; configure-only and secret-free (ADR-0007).',
    ),
    demo: described(z.optional(z.strictObject({ tape: kebabId, section: oneLine })), DEMO),
    internal: described(
      z.optional(z.literal(true)),
      'A module with no user-facing feature of its own, so no demo.',
    ),
  })
  .register(z.globalRegistry, {
    title: 'Module manifest',
    description:
      'One switchable module as data (ADR-0003, ADR-0014). Declare exactly one of demo or internal.',
    oneOf: [{ required: ['demo'] }, { required: ['internal'] }],
  });

/** A validated module manifest, with every list and record defaulted. */
export type ModuleManifest = z.output<typeof moduleManifestSchema>;

/** A typed module option with its default. */
export type OptionSpec = z.output<typeof option>;

/** The contract of `modules/presets.json`: the presets in chain order, each containing the one before it. */
export const presetCatalogSchema = z.strictObject({
  default: kebabId,
  presets: z
    .array(
      z.strictObject({
        name: kebabId,
        description: oneLine,
        defaults: z.strictObject({
          sessionStartCap: z
            .int()
            .check(
              z.minimum(1),
              z.maximum(10_000, { error: 'stay under the 10,000-character hook output limit' }),
            ),
        }),
      }),
    )
    .check(z.minLength(1)),
});

/** A validated `modules/presets.json`. */
export type PresetCatalog = z.output<typeof presetCatalogSchema>;
