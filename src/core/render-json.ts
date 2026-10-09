import type { Brand } from './brand.js';
import { HOOK_EVENTS, type ModuleManifest } from './manifest-schema.js';
import { compareText } from './text.js';

/** A JSON value built in code, never from a text template (#20). */
export type JsonValue =
  string | number | boolean | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** One module's entries in a co-owned JSON file, with the key that owns each entry (ADR-0014). */
export interface JsonPart {
  readonly value: Readonly<Record<string, JsonValue>>;
  readonly keys: readonly string[];
}

type Hook = ModuleManifest['hooks'][number];
type Server = ModuleManifest['mcpServers'][number];

// Claude Code substitutes this placeholder in exec-form args, so a project path with spaces needs no quoting.
const PROJECT_DIR = '${CLAUDE_PROJECT_DIR}';
const PERMISSION_LISTS = ['allow', 'ask', 'deny'] as const;

/** Where a hook bundle such as `dist/hooks/guard-bash.mjs` is installed in the project (ADR-0015). */
export function hookScriptPath(script: string, brand: Brand): string {
  return `${brand.hookDir}/${script.slice(script.lastIndexOf('/') + 1)}`;
}

/** Serialises a JSON value with two-space indentation and a trailing newline. */
export function toJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortedRecord(
  record: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (record === undefined) return undefined;
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareText(left, right)));
}

function withoutUndefined(entries: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(entries).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

function hookGroup(hook: Hook, brand: Brand): JsonValue {
  const handler = withoutUndefined({
    type: 'command',
    command: 'node',
    args: [`${PROJECT_DIR}/${hookScriptPath(hook.script, brand)}`],
    timeout: hook.timeout,
    if: hook.if,
  });
  return withoutUndefined({ matcher: hook.matcher, hooks: [handler] });
}

/** The `.claude/settings.json` entries of one module: exec-form hook registrations and permission rules. */
export function settingsPart(manifest: ModuleManifest, brand: Brand): JsonPart {
  const keys: string[] = [];
  const hooks: Record<string, JsonValue[]> = {};
  for (const event of HOOK_EVENTS) {
    const registered = manifest.hooks.filter((hook) => hook.event === event);
    if (registered.length === 0) continue;
    hooks[event] = registered.map((hook) => hookGroup(hook, brand));
    keys.push(...registered.map((hook) => `hooks.${event} ${hookScriptPath(hook.script, brand)}`));
  }
  const permissions: Record<string, readonly string[]> = {};
  for (const list of PERMISSION_LISTS) {
    const rules = manifest.permissions[list] ?? [];
    if (rules.length === 0) continue;
    permissions[list] = rules;
    keys.push(...rules.map((rule) => `permissions.${list} ${rule}`));
  }
  const value = withoutUndefined({
    hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
    permissions: Object.keys(permissions).length > 0 ? permissions : undefined,
  });
  return { value, keys };
}

function serverEntry(server: Server): JsonValue {
  if (server.type === 'stdio') {
    return withoutUndefined({
      type: server.type,
      command: server.command,
      args: server.args,
      env: sortedRecord(server.env),
    });
  }
  return withoutUndefined({
    type: server.type,
    url: server.url,
    headers: sortedRecord(server.headers),
    headersHelper: server.headersHelper,
  });
}

/** The `.mcp.json` entries of one module: its MCP servers by name, configure-only (ADR-0007). */
export function mcpPart(manifest: ModuleManifest): JsonPart {
  const servers = Object.fromEntries(manifest.mcpServers.map((server) => [server.name, serverEntry(server)]));
  return {
    value: { mcpServers: servers },
    keys: manifest.mcpServers.map((server) => `mcpServers ${server.name}`),
  };
}
