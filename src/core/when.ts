import type { ModuleManifest } from './manifest-schema.js';
import type { ModuleOptions } from './options.js';
import type { Stack } from './schema-parts.js';

/** A `when` predicate from a manifest: on the module itself or on one of its files. */
export type When = ModuleManifest['when'];

/** Says why `when` does not hold for this stack and these option values, or returns undefined when it holds. */
export function whenMismatch(
  when: When,
  stack: readonly Stack[],
  options: ModuleOptions,
): string | undefined {
  if (when === undefined) return undefined;
  if (when.stack !== undefined && !when.stack.some((name) => stack.includes(name))) {
    const project = stack.length === 0 ? 'none' : stack.join(', ');
    return `needs the ${when.stack.join(' or ')} stack, and the project stack is ${project}`;
  }
  for (const [name, expected] of Object.entries(when.options ?? {})) {
    if (options[name] !== expected) return `needs option ${name} to be ${JSON.stringify(expected)}`;
  }
  return undefined;
}
