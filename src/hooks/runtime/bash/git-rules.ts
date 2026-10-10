import type { Command } from '../shell/commands.js';
import { hasExpansion } from '../shell/syntax.js';
import { hasLong, type OptionSpec, parseOptions, type ParsedOptions } from './cli-options.js';
import { type ConfigEntry, configEntry, configVerdict } from './git-config.js';
import { judgeBranch, judgeCheckout, judgeRestore, judgeSwitch } from './git-worktree-rules.js';
import type { JudgeContext } from './judge-context.js';
import { ask, deny, type Verdict } from './verdicts.js';

const NO_VERIFY = deny('--no-verify skips the quality gates. Fix the failing check instead.');
/** Verdict for turning husky off with HUSKY=0, under the `blockNoVerify` option. */
export const HUSKY_OFF = deny('HUSKY=0 skips the quality gates. Fix the failing check instead.');
const FORCE_PUSH = deny('Plain force-push is blocked. Use --force-with-lease on a feature branch.');
const FORCE_MAIN = deny('Force-pushing main/master is blocked.');
const REMOTE_DELETE = deny('Deleting or mirroring remote branches is blocked.');
const DISCARDS_WORK = ask('This discards work irreversibly. Confirm with the user.');
const OUTSIDE_REPO = ask('This git command can write files or read outside the repo. Confirm with the user.');
const RUNS_PAGER = ask('git grep -O runs the program it names on the matches. Confirm with the user.');
const RUNS_ARGUMENT = ask('This git command runs a program its arguments name. Confirm with the user.');
const UNCHECKED = ask(
  'A variable or command output decides what this git command does. Confirm with the user.',
);

const GLOBAL_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
]);
const PUSH_VALUES: OptionSpec = { short: 'o', long: ['--push-option', '--repo', '--receive-pack', '--exec'] };
const COMMIT_VALUES: OptionSpec = {
  short: 'mFCct',
  long: [
    ...['--message', '--file', '--author', '--date', '--template', '--reuse-message', '--reedit-message'],
    ...['--fixup', '--squash', '--trailer', '--cleanup', '--pathspec-from-file'],
  ],
};
const GREP_VALUES: OptionSpec = {
  short: 'efABCm',
  long: ['--max-count', '--threads', '--context', '--max-depth'],
};
const CONFIG_VALUES: OptionSpec = {
  short: 'f',
  long: ['--file', '--blob', '--type', '--default', '--comment', '--value'],
};

type GitJudge = (options: ParsedOptions, command: Command, context: JudgeContext) => Verdict | null;

interface GlobalOptions {
  readonly configs: ConfigEntry[];
  readonly execPath: boolean;
  readonly subcommand: string;
  readonly rest: string[];
}

// `-c key=value` sets a value; `--config-env key=VAR` and `--config-env=key=VAR` take it from a variable.
function configOf(option: string, next: string | undefined): ConfigEntry | undefined {
  if (option === '-c' || option === '--config-env') {
    return next === undefined ? undefined : configEntry(next, option !== '-c');
  }
  const fromEnvironment = /^--config-env=(.*)$/.exec(option)?.[1];
  return fromEnvironment === undefined ? undefined : configEntry(fromEnvironment, true);
}

function globalOptions(args: readonly string[]): GlobalOptions {
  const configs: ConfigEntry[] = [];
  let execPath = false;
  let index = 0;
  for (let option = args[index]; option?.startsWith('-') === true; option = args[index]) {
    const config = configOf(option, args[index + 1]);
    if (config !== undefined) configs.push(config);
    // `--exec-path=<dir>` runs git's own programs from that folder; without a value it only prints the path.
    execPath ||= option.startsWith('--exec-path=');
    index += GLOBAL_VALUE_OPTIONS.has(option) ? 2 : 1;
  }
  return { configs, execPath, subcommand: args[index] ?? '', rest: args.slice(index + 1) };
}

function targetsMainBranch(refspec: string): boolean {
  const destination = refspec.slice(refspec.lastIndexOf(':') + 1).replace(/^\+?(refs\/heads\/)?/, '');
  return destination === 'main' || destination === 'master';
}

function forcesMainBranch(options: ParsedOptions, refspecs: readonly string[]): boolean {
  const leased = hasLong(options, '--force-with-lease', 9) || hasLong(options, '--force-if-includes', 9);
  const leasedRefs = options.values
    .filter(([name]) => name.startsWith('--force-with'))
    .map(([, value]) => value.split(':')[0] ?? '');
  return leased && [...refspecs, ...leasedRefs].some(targetsMainBranch);
}

function deletesRemote(options: ParsedOptions, refspecs: readonly string[]): boolean {
  const deleting =
    options.short.has('d') || hasLong(options, '--delete', 4) || hasLong(options, '--mirror', 4);
  return deleting || refspecs.some((refspec) => refspec.startsWith(':'));
}

const judgePush: GitJudge = (options) => {
  const refspecs = [...options.operands, ...options.afterDashes];
  const forced = options.short.has('f') || options.long.has('--force');
  if (forced || refspecs.some((refspec) => refspec.startsWith('+'))) return FORCE_PUSH;
  if (deletesRemote(options, refspecs)) return REMOTE_DELETE;
  if (forcesMainBranch(options, refspecs)) return FORCE_MAIN;
  return refspecs.some(hasExpansion) ? UNCHECKED : null;
};

const judgeCommit: GitJudge = (options, command, { options: { blockNoVerify } }) => {
  if (!blockNoVerify) return null;
  if (options.short.has('n')) return NO_VERIFY;
  if (command.assignments.includes('HUSKY=0')) return HUSKY_OFF;
  const huskyFromExpansion = (assignment: string): boolean =>
    assignment.startsWith('HUSKY=') && hasExpansion(assignment);
  return command.assignments.some(huskyFromExpansion) ? UNCHECKED : null;
};

// `git config <key> <value>`, `git config set <key> <value>` and `--add` set a key; a read names only a key.
function configSetting(operands: readonly string[]): ConfigEntry | null {
  const [first = '', second, third] = operands;
  if (first === 'set' && second !== undefined && third !== undefined) return { key: second, value: third };
  return second === undefined ? null : { key: first, value: second };
}

const judgeConfig: GitJudge = ({ operands }, _command, context) => {
  const setting = configSetting(operands);
  return setting === null ? null : configVerdict([setting], 'config', context);
};

const judgeReset: GitJudge = (options) => (hasLong(options, '--hard', 4) ? DISCARDS_WORK : null);
const judgeClean: GitJudge = (options) =>
  options.short.has('f') || hasLong(options, '--force', 3) ? DISCARDS_WORK : null;
const judgeStash: GitJudge = ({ operands }) =>
  ['drop', 'clear'].includes(operands[0] ?? '') ? DISCARDS_WORK : null;
const judgeOutput: GitJudge = (options) =>
  options.long.has('--output') || options.long.has('--no-index') ? OUTSIDE_REPO : null;
const judgeGrep: GitJudge = (options) =>
  options.short.has('O') || hasLong(options, '--open-files-in-pager', 4) ? RUNS_PAGER : null;
const judgeRm: GitJudge = (options) =>
  options.short.has('f') || options.long.has('--force') ? DISCARDS_WORK : null;
const judgeWorktree: GitJudge = (options) =>
  options.operands[0] === 'remove' && (options.short.has('f') || options.long.has('--force'))
    ? DISCARDS_WORK
    : null;
// `git clone -c core.fsmonitor=<program>` sets config in the new repository, which its checkout then uses.
const judgeClone: GitJudge = (options, _command, context) => {
  if (options.short.has('u')) return RUNS_ARGUMENT;
  const configs = options.values.filter(([name]) => name === '-c' || name === '--config');
  return configVerdict(
    configs.map(([, value]) => configEntry(value, false)),
    'clone',
    context,
  );
};

const SUBCOMMANDS: ReadonlyMap<string, { readonly judge: GitJudge; readonly values?: OptionSpec }> = new Map([
  ['push', { judge: judgePush, values: PUSH_VALUES }],
  ['commit', { judge: judgeCommit, values: COMMIT_VALUES }],
  ['reset', { judge: judgeReset }],
  ['clean', { judge: judgeClean, values: { short: 'e' } }],
  ['checkout', { judge: judgeCheckout, values: { short: 'bB', long: ['--orphan'] } }],
  ['restore', { judge: judgeRestore, values: { short: 's', long: ['--source'] } }],
  [
    'switch',
    { judge: judgeSwitch, values: { short: 'cC', long: ['--create', '--force-create', '--orphan'] } },
  ],
  ['branch', { judge: judgeBranch, values: { short: 'u', long: ['--set-upstream-to'] } }],
  ['stash', { judge: judgeStash }],
  ['diff', { judge: judgeOutput }],
  ['log', { judge: judgeOutput }],
  ['show', { judge: judgeOutput }],
  ['grep', { judge: judgeGrep, values: GREP_VALUES }],
  ['config', { judge: judgeConfig, values: CONFIG_VALUES }],
  ['rm', { judge: judgeRm }],
  ['worktree', { judge: judgeWorktree }],
  [
    'clone',
    { judge: judgeClone, values: { short: 'obcju', long: ['--origin', '--branch', '--config', '--jobs'] } },
  ],
]);

// `--upload-pack`, `--receive-pack` and `--exec` name the program git runs on the other side, which for a local
// or ssh remote is a program on this machine.
function runsArgument(options: ParsedOptions): boolean {
  return (
    hasLong(options, '--upload-pack', 5) ||
    hasLong(options, '--receive-pack', 6) ||
    options.long.has('--exec')
  );
}

/** Judges a git invocation: config and hook bypasses, destructive pushes, and commands that discard work or escape the repo. */
export function gitRule(command: Command, context: JudgeContext): Verdict | null {
  const { configs, execPath, subcommand, rest } = globalOptions(command.args);
  const fromConfig = configVerdict(configs, subcommand, context);
  if (fromConfig !== null) return fromConfig;
  const rule = SUBCOMMANDS.get(subcommand);
  const options = parseOptions(rest, rule?.values);
  if (context.options.blockNoVerify && hasLong(options, '--no-verify', 6)) return NO_VERIFY;
  if (execPath || runsArgument(options)) return RUNS_ARGUMENT;
  return rule === undefined ? null : rule.judge(options, command, context);
}
