import type { Stack } from './schema-parts.js';
import type { StackProfile, Tool } from './stack-profile.js';

/** The stack each tool detection knows belongs to, so a tool counts only while its stack is in effect. */
export const TOOL_STACK: Readonly<Record<Tool, Stack>> = {
  prettier: 'ts',
  biome: 'ts',
  eslint: 'ts',
  tsc: 'ts',
  vitest: 'ts',
  jest: 'ts',
  ruff: 'python',
  black: 'python',
  mypy: 'python',
  pyright: 'python',
  pytest: 'python',
};

/** The tools format-on-edit runs, as init records them, and every detected tool of the stacks in effect. */
export interface FormatTools {
  /** prettier, else biome, for TS/JS; ruff for Python unless black formats it. */
  readonly formatters: readonly Tool[];
  /** eslint for TS/JS and ruff for Python. */
  readonly linters: readonly Tool[];
  /** Every tool detection found for the stacks in effect, which a module's `when.tools` reads. */
  readonly detected: readonly Tool[];
}

const isTool = (name: string): name is Tool => Object.hasOwn(TOOL_STACK, name);

/**
 * The tools format-on-edit runs for a project (#37), from its detected tools and the stacks in effect: prettier,
 * else biome, and eslint for TS/JS; ruff for Python, as its formatter only when black is not there. Pure.
 */
export function formatTools(profile: StackProfile, stack: readonly Stack[]): FormatTools {
  const { formatters, linters, typeCheckers, testRunners } = profile.tools;
  const detected = [...new Set([...formatters, ...linters, ...typeCheckers, ...testRunners])]
    .filter(isTool)
    .filter((tool) => stack.includes(TOOL_STACK[tool]));
  const has = (tool: Tool): boolean => detected.includes(tool);
  const scriptFormatter = (['prettier', 'biome'] as const).find(has);
  return {
    formatters: [
      ...(scriptFormatter === undefined ? [] : [scriptFormatter]),
      ...(has('ruff') && !has('black') ? (['ruff'] as const) : []),
    ],
    linters: (['eslint', 'ruff'] as const).filter(has),
    detected,
  };
}
