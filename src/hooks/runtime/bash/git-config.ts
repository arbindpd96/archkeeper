import type { Command } from '../shell/commands.js';
import { hasExpansion } from '../shell/syntax.js';
import type { JudgeContext } from './judge-context.js';
import { ask, deny, type Verdict } from './verdicts.js';

/** Verdict for pointing `core.hooksPath` elsewhere, which skips every git hook. */
export const HOOKS_PATH = deny('Overriding core.hooksPath skips hooks. Fix the failing check instead.');
const RUNS_PROGRAM = ask(
  'git can run a program this config or environment names, such as a pager, editor, diff tool or ssh command. ' +
    'Confirm with the user.',
);
const GIT_ALIAS = ask('A git alias can hide what a command runs. Confirm with the user.');
const UNCHECKED = ask(
  'A variable or command output decides what this git command does. Confirm with the user.',
);
const DISCARDS_WORK = ask('This discards work irreversibly. Confirm with the user.');

const HOOKS_PATH_KEY = /core\.hookspath/i;
const ALIAS_KEY = /^alias\./i;
const CLEAN_UNGUARDED = /^clean\.requireforce$/i;

// Keys that change only what git records, shows or how it merges, and never name a program to run (#31).
const SAFE_KEYS: ReadonlySet<string> = new Set([
  ...['user.name', 'user.email', 'author.name', 'author.email', 'committer.name', 'committer.email'],
  ...['init.defaultbranch', 'core.quotepath', 'core.autocrlf', 'core.safecrlf', 'core.eol', 'core.abbrev'],
  ...['commit.gpgsign', 'tag.gpgsign', 'pull.rebase', 'pull.ff', 'merge.ff', 'push.default'],
  ...['push.autosetupremote', 'fetch.prune', 'log.decorate', 'diff.renames', 'status.showuntrackedfiles'],
  ...['rebase.autostash', 'gc.auto'],
]);
const SAFE_PREFIXES: readonly string[] = ['color.', 'advice.'];
// A pager or editor that runs nothing else: `GIT_PAGER=cat git log`, `GIT_EDITOR=true git rebase --continue`.
const SAFE_PROGRAMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['core.pager', ['cat', '']],
  ['core.editor', ['true', ':']],
  ['sequence.editor', ['true', ':']],
  ['GIT_PAGER', ['cat', '']],
  ['GIT_EDITOR', ['true', ':']],
  ['GIT_SEQUENCE_EDITOR', ['true', ':']],
]);
// Environment variables through which git, or a program git starts, runs a program or reads another config.
const PROGRAM_VARIABLES: ReadonlySet<string> = new Set([
  ...['GIT_EXTERNAL_DIFF', 'GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_PAGER', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR'],
  ...[
    'GIT_ASKPASS',
    'GIT_PROXY_COMMAND',
    'GIT_EXEC_PATH',
    'GIT_TEMPLATE_DIR',
    'GIT_CONFIG',
    'GIT_CONFIG_GLOBAL',
  ],
  ...['GIT_CONFIG_SYSTEM', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'],
]);
const CONFIG_PAIR = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;
const EXPORTERS: ReadonlySet<string> = new Set(['', 'export', 'declare', 'typeset', 'readonly', 'local']);

/** One config entry a git command line sets: its key and value; the value is null when it comes from the environment. */
export interface ConfigEntry {
  readonly key: string;
  readonly value: string | null;
}

/** Reads `key=value` from `-c`, or `key=ENV` from `--config-env`, whose value git takes from that variable. */
export function configEntry(setting: string, fromEnvironment: boolean): ConfigEntry {
  const equals = setting.indexOf('=');
  if (equals === -1) return { key: setting, value: fromEnvironment ? null : 'true' };
  return { key: setting.slice(0, equals), value: fromEnvironment ? null : setting.slice(equals + 1) };
}

function isSafeProgram(name: string, value: string | null): boolean {
  return value !== null && (SAFE_PROGRAMS.get(name)?.includes(value.trim()) ?? false);
}

/** Tells whether git may run a program because of this config entry, unless its key is on the safe allowlist. */
export function mayRunProgram({ key, value }: ConfigEntry): boolean {
  const lower = key.toLowerCase();
  if (SAFE_KEYS.has(lower) || SAFE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  return !isSafeProgram(lower, value);
}

/**
 * Judges config entries set for one git command or by `git config`; `subcommand` is git's subcommand. A value from
 * an expansion counts only for a key that is not safe, and those ask anyway.
 */
export function configVerdict(
  entries: readonly ConfigEntry[],
  subcommand: string,
  context: JudgeContext,
): Verdict | null {
  const keys = entries.map(({ key }) => key);
  if (context.options.blockNoVerify && keys.some((key) => HOOKS_PATH_KEY.test(key))) return HOOKS_PATH;
  if (keys.some((key) => ALIAS_KEY.test(key))) return GIT_ALIAS;
  if (keys.some(hasExpansion)) return UNCHECKED;
  const cleaning = subcommand === 'clean' || subcommand === 'config';
  if (cleaning && keys.some((key) => CLEAN_UNGUARDED.test(key))) return DISCARDS_WORK;
  return entries.some(mayRunProgram) ? RUNS_PROGRAM : null;
}

function variableOf(setting: string): { name: string; value: string | null } {
  const equals = setting.indexOf('=');
  return equals === -1
    ? { name: setting, value: null }
    : { name: setting.slice(0, equals).replace(/\+$/, ''), value: setting.slice(equals + 1) };
}

function setsProgramVariable(setting: string): boolean {
  const { name, value } = variableOf(setting);
  if (!PROGRAM_VARIABLES.has(name) && !CONFIG_PAIR.test(name)) return false;
  return !isSafeProgram(name, value);
}

/**
 * Asks when a command sets or exports a variable through which git runs a program (#31): `GIT_PAGER`,
 * `GIT_EDITOR`, `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_*` and the like, unless the value is a pager
 * or editor that runs nothing else. Any program the command starts may run git, so every command counts.
 */
export function gitEnvironmentRule(command: Command, context: JudgeContext): Verdict | null {
  const exported = EXPORTERS.has(command.program) ? command.args : [];
  const settings = [...command.assignments, ...exported];
  const hooksPath = settings.some((setting) => HOOKS_PATH_KEY.test(setting));
  if (context.options.blockNoVerify && hooksPath) return HOOKS_PATH;
  return settings.some(setsProgramVariable) ? RUNS_PROGRAM : null;
}
