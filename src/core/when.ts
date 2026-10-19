import type { ModuleManifest } from './manifest-schema.js';
import type { ModuleOptions } from './options.js';
import type { Stack } from './schema-parts.js';

/** A `when` predicate from a manifest: on the module itself or on one of its files. */
export type When = ModuleManifest['when'];

function toolsMismatch(wanted: readonly string[], tools: readonly string[]): string | undefined {
  if (wanted.some((tool) => tools.includes(tool))) return undefined;
  if (wanted.length === 1) return `needs ${wanted.join('')}, which was not detected`;
  return `needs ${wanted.slice(0, -1).join(', ')} or ${wanted.at(-1) ?? ''}, and none was detected`;
}

/**
 * Says why `when` does not hold for this stack, these option values and `tools`, the detected tools of the stacks in
 * effect, or returns undefined when it holds.
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
  const missing = when.tools === undefined ? undefined : toolsMismatch(when.tools, tools);
  if (missing !== undefined) return missing;
  for (const [name, expected] of Object.entries(when.options ?? {})) {
    if (options[name] !== expected) return `needs option ${name} to be ${JSON.stringify(expected)}`;
  }
  return undefined;
}
