import type { ModuleManifest } from './manifest-schema.js';
import type { ModuleOptions } from './options.js';
import type { Stack } from './schema-parts.js';

/** A `when` predicate from a manifest: on the module itself or on one of its files. */
export type When = ModuleManifest['when'];

// The reason names the stacks in effect, since a tool detected only for a stack the run leaves out counts as none.
function toolsMismatch(
  wanted: readonly string[],
  tools: readonly string[],
  stack: readonly Stack[],
): string | undefined {
  if (wanted.some((tool) => tools.includes(tool))) return undefined;
  const needs =
    wanted.length === 1 ? wanted.join('') : `${wanted.slice(0, -1).join(', ')} or ${wanted.at(-1) ?? ''}`;
  if (stack.length === 0) return `needs ${needs}, and the project stack is none`;
  const none = wanted.length === 1 ? 'which was not detected' : 'and none was detected';
  return `needs ${needs}, ${none} for the ${stack.join(' and ')} stack${stack.length === 1 ? '' : 's'}`;
}

/**
 * Says why `when` does not hold for this stack, these option values and `tools`, the detected tools of the stacks in
 * effect, or returns undefined when it holds; a missing tool's reason names the stacks in effect.
 */
export function whenMismatch(
  when: When,
  stack: readonly Stack[],
  options: ModuleOptions,
  tools: readonly string[],
): string | undefined {
  if (when === undefined) return undefined;
  if (when.stack !== undefined && !when.stack.some((name) => stack.includes(name))) {
    const project = stack.length === 0 ? 'none' : stack.join(', ');
    return `needs the ${when.stack.join(' or ')} stack, and the project stack is ${project}`;
  }
  const missing = when.tools === undefined ? undefined : toolsMismatch(when.tools, tools, stack);
  if (missing !== undefined) return missing;
  for (const [name, expected] of Object.entries(when.options ?? {})) {
    if (options[name] !== expected) return `needs option ${name} to be ${JSON.stringify(expected)}`;
  }
  return undefined;
}
