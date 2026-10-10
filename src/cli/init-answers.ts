import budgets from '../../budgets.json' with { type: 'json' };
import type { ProjectConfig } from '../core/config-schema.js';
import { UsageError } from '../core/errors.js';
import type { Catalog } from '../core/loader.js';
import { type Stack, STACKS } from '../core/schema-parts.js';
import type { GitState } from './git-state.js';
import type { Choice, Prompter } from './prompts.js';
import type { Reporter } from './init-report.js';

/** What init needs to ask a question or decide without one. */
export interface Asking {
  /** Prompts may run: a terminal, no CI, no --yes and no --json. */
  readonly interactive: boolean;
  readonly yes: boolean;
  readonly prompter: Prompter;
  readonly report: Reporter;
}

const STACK_HINT = 'pass --stack ts, python, ts,python or none';

/** Reads `--stack ts|python|ts,python|none` (#27), or undefined when the flag is absent. */
export function stackFlag(value: string | undefined): Stack[] | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === 'none') return [];
  const names = value.split(',').map((name) => name.trim());
  const unknown = names.find((name) => !(STACKS as readonly string[]).includes(name));
  if (unknown !== undefined || names.length === 0) {
    throw new UsageError({
      file: '--stack',
      location: '',
      problem: `"${unknown ?? ''}" is not a stack`,
      hint: STACK_HINT,
    });
  }
  return STACKS.filter((stack) => names.includes(stack));
}

/**
 * Applies `--modules +id,-id` (#27) to the config's own `add` and `remove` lists: `+id` or a bare `id` adds a
 * module, `-id` leaves one out, and an id moves out of the other list. An unknown id names the flag and the ids.
 */
export function moduleChanges(
  value: string | undefined,
  config: ProjectConfig | undefined,
  catalog: Catalog,
): { add: string[]; remove: string[] } {
  let add = [...(config?.modules.add ?? [])];
  let remove = [...(config?.modules.remove ?? [])];
  for (const item of (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')) {
    const id = item.replace(/^[+-]/, '');
    if (!catalog.modules.has(id)) {
      const known = [...catalog.modules.keys()].join(', ');
      throw new UsageError({
        file: '--modules',
        location: '',
        problem: `"${id}" is not a module`,
        hint: `use +id or -id with one of ${known}`,
      });
    }
    const removing = item.startsWith('-');
    add = removing ? add.filter((name) => name !== id) : [...new Set([...add, id])];
    remove = removing ? [...new Set([...remove, id])] : remove.filter((name) => name !== id);
  }
  return { add, remove };
}

/** Checks init's own flags before anything is read or asked, so a typo fails at once with the flag to fix (#27). */
export function checkInitFlags(
  flags: { readonly preset?: string; readonly modules?: string; readonly stack?: string },
  catalog: Catalog,
): void {
  const names = catalog.presets.map((preset) => preset.name);
  if (flags.preset !== undefined && !names.includes(flags.preset)) {
    const problem = `"${flags.preset}" is not a preset`;
    throw new UsageError({
      file: '--preset',
      location: '',
      problem,
      hint: `pass one of ${names.join(', ')}`,
    });
  }
  stackFlag(flags.stack);
  moduleChanges(flags.modules, undefined, catalog);
}

const GIT_PROBLEMS: Readonly<Record<Exclude<GitState, 'clean'>, readonly [problem: string, fix: string]>> = {
  dirty: [
    'has uncommitted changes, so git cannot tell them apart from what init changes',
    'commit or stash your changes first',
  ],
  'not-a-repo': [
    'is not a git repository, so git cannot show or undo what init changes',
    'run git init and commit first',
  ],
  unknown: [
    'could not be checked with git, so init cannot tell whether git can undo its changes',
    'check that git is installed and works here',
  ],
};

/**
 * Warns when the project is not a clean git repository and asks whether to go on (#27). --yes goes on; without a
 * terminal the run stops with the flag to pass. Init keeps a backup of every file it changes either way.
 */
export async function goOnWithoutGit(asking: Asking, state: GitState, root: string): Promise<boolean> {
  if (state === 'clean') return true;
  const [problem, fix] = GIT_PROBLEMS[state];
  if (!asking.yes && !asking.interactive) {
    throw new UsageError({
      file: root,
      location: '',
      problem,
      hint: `${fix}, or pass --yes to go on anyway`,
    });
  }
  asking.report.warn(`${root} ${problem}.`);
  if (asking.yes) return true;
  return (await asking.prompter.confirm('Continue anyway?', false)) === true;
}

function tokens(preset: string): string {
  const budget = (budgets.alwaysOnContext as Readonly<Record<string, unknown>>)[preset];
  return typeof budget === 'number'
    ? `up to ${String(budget / 1000)}k tokens always loaded`
    : 'no context budget';
}

/**
 * The preset to install (#27): `--preset`, else the config's, as `update` would, else the user's pick from a list
 * that shows each preset's always-on token budget from budgets.json, else the catalog's default. Undefined when the
 * user cancels.
 */
export async function choosePreset(
  asking: Asking,
  catalog: Catalog,
  given: { readonly flag?: string | undefined; readonly configured?: string | undefined },
): Promise<string | undefined> {
  const known = given.flag ?? given.configured;
  if (known !== undefined || !asking.interactive) return known ?? catalog.defaultPreset;
  const choices: Choice<string>[] = catalog.presets.map((preset) => ({
    value: preset.name,
    label: preset.name,
    hint: `${preset.description.replace(/\.$/, '')} (${tokens(preset.name)})`,
  }));
  return asking.prompter.select('Choose a preset', choices, catalog.defaultPreset);
}

/** The line init prints for the chosen preset, with its always-on token budget. */
export function presetLine(preset: string): string {
  return `Preset: ${preset} (${tokens(preset)})`;
}

/** Asks for a yes before init writes (#27); without a terminal, --yes is that yes, and its absence is an error. */
export async function confirmApply(asking: Asking): Promise<boolean> {
  if (asking.yes) return true;
  if (!asking.interactive) {
    throw new UsageError({
      file: 'init',
      location: '',
      problem: 'needs a yes to write, and there is no terminal to ask on',
      hint: 'pass --yes to apply the plan, or --dry-run to see it without writing',
    });
  }
  return (await asking.prompter.confirm('Apply this plan?', true)) === true;
}
