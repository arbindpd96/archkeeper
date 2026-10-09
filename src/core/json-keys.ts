import { HOOK_EVENTS } from './manifest-schema.js';

/** The `$schema` entry the json strategy adds to a settings file that has none; the kit owns it like any entry. */
export const SCHEMA_KEY = '$schema';

/**
 * An owned key of a co-owned JSON file (ADR-0014): `$schema`, a permission rule by list and exact string, a hook
 * by event and installed script path, or an MCP server by name, such as `permissions.deny Bash(rm -rf:*)`.
 */
export const JSON_KEY = new RegExp(
  String.raw`^(?:\$schema|(?:permissions\.(?:allow|ask|deny)|hooks\.(?:${HOOK_EVENTS.join('|')})|mcpServers) \S.*)$`,
);

/** How an owned key finds its entry: the container's JSON path, and whether it matches by value, hook or name. */
export interface EntryKey {
  readonly container: readonly string[];
  readonly match: 'string' | 'hook' | 'property';
  readonly id: string;
}

/** Splits an owned key into its container and the identity of its entry; the key must match {@link JSON_KEY}. */
export function entryKey(key: string): EntryKey {
  if (key === SCHEMA_KEY) return { container: [], match: 'property', id: SCHEMA_KEY };
  const space = key.indexOf(' ');
  const container = key.slice(0, space).split('.');
  const id = key.slice(space + 1);
  if (container[0] === 'mcpServers') return { container, match: 'property', id };
  return { container, match: container[0] === 'hooks' ? 'hook' : 'string', id };
}
