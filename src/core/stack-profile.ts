import type { ProblemReport } from './errors.js';
import { isRecord } from './json.js';
import type { Stack } from './schema-parts.js';

/** How detection reads a project (#25): the names in a folder and the text of a file, injected so it stays pure. */
export interface ProjectView {
  /** The names in a project folder, `''` for the root; empty when the folder is absent. */
  readonly list: (folder: string) => readonly string[];
  /** The text of a project file, or undefined when it is absent or not a regular UTF-8 text file. */
  readonly read: (file: string) => string | undefined;
}

/** Languages detection reports, in this order (ADR-0006). */
export const LANGUAGES = ['typescript', 'javascript', 'python'] as const;

/** A language from {@link LANGUAGES}. */
export type Language = (typeof LANGUAGES)[number];

/** The tools detection knows, by the job each does, in report order; biome and ruff do two jobs. */
export const TOOL_JOBS = {
  formatters: ['prettier', 'biome', 'ruff', 'black'],
  linters: ['eslint', 'biome', 'ruff'],
  typeCheckers: ['tsc', 'mypy', 'pyright'],
  testRunners: ['vitest', 'jest', 'pytest'],
} as const;

/** The detected tools by job, each list in {@link TOOL_JOBS} order. */
export type ToolsByJob = { readonly [Job in keyof typeof TOOL_JOBS]: readonly string[] };

/** A tool from {@link TOOL_JOBS}; a language's detection can report no other name, so none is dropped. */
export type Tool = (typeof TOOL_JOBS)[keyof typeof TOOL_JOBS][number];

/** Frameworks detection reports, in this order; nothing depends on them yet. */
export const FRAMEWORKS = ['react', 'next', 'django', 'fastapi'] as const;

/** A framework from {@link FRAMEWORKS}. */
export type Framework = (typeof FRAMEWORKS)[number];

/** What a detected command is for, in table order. */
export const PURPOSES = ['build', 'test', 'lint', 'format', 'typecheck'] as const;

/** A purpose from {@link PURPOSES}. */
export type CommandPurpose = (typeof PURPOSES)[number];

/** A project command the kit built from fixed words, such as `pnpm run test` or `uv run pytest`. */
export interface DetectedCommand {
  readonly stack: Stack;
  readonly purpose: CommandPurpose;
  readonly command: string;
}

/** The Python project manager whose `run` prefixes Python commands; `pip` runs them bare. */
export type PythonManager = 'uv' | 'poetry' | 'pip';

/** The Claude Code files already in the project before the kit wrote anything (#25). */
export interface ClaudeSetup {
  readonly claudeMd: boolean;
  readonly agentsMd: boolean;
  readonly settings: boolean;
  readonly hooks: boolean;
  readonly skills: boolean;
}

/** Everything detection found in a project: the stack in effect by default, the tools and the commands (#25). */
export interface StackProfile {
  readonly stack: readonly Stack[];
  readonly languages: readonly Language[];
  /** The JS package manager, such as `npm` or `pnpm`, or null when the project has no package.json. */
  readonly packageManager: string | null;
  readonly pythonManager: PythonManager | null;
  readonly tools: ToolsByJob;
  readonly frameworks: readonly string[];
  /** Whether the root declares workspaces; reported only. */
  readonly monorepo: boolean;
  readonly commands: readonly DetectedCommand[];
  /** Project docs at the root that instructions may point to, such as `README.md`. */
  readonly docs: readonly string[];
  readonly claude: ClaudeSetup;
  /** Files detection could not read fully, such as malformed TOML; the rest of the profile still stands. */
  readonly warnings: readonly ProblemReport[];
}

/** What one language's detection contributes to a profile. */
export interface StackSignals {
  readonly languages: readonly Language[];
  readonly tools: readonly Tool[];
  readonly frameworks: readonly Framework[];
  readonly monorepo: boolean;
  readonly commands: readonly DetectedCommand[];
  readonly warnings: readonly ProblemReport[];
}

/** The values of a plain object, or undefined when `value` is not one: detection reads project files tolerantly. */
export function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

/** The string items of a list, skipping anything else, or none when `value` is not a list. */
export function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Keeps the items of `vocabulary` that `found` holds, in vocabulary order, so a profile never depends on file order. */
export function inOrder<Item extends string>(vocabulary: readonly Item[], found: Iterable<string>): Item[] {
  const set = new Set(found);
  return vocabulary.filter((item) => set.has(item));
}
