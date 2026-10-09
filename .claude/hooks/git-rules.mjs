import { hasLong, parseOptions } from './cli-options.mjs';

const deny = (reason) => Object.freeze({ decision: 'deny', reason });
const ask = (reason) => Object.freeze({ decision: 'ask', reason });

const NO_VERIFY = deny('--no-verify skips the quality gates. Fix the failing check instead.');
/** Verdict for turning husky off with HUSKY=0. */
export const HUSKY_OFF = deny('HUSKY=0 skips the quality gates. Fix the failing check instead.');
/** Verdict for pointing core.hooksPath elsewhere, which skips every git hook. */
export const HOOKS_PATH = deny('Overriding core.hooksPath skips hooks. Fix the failing check instead.');
const FORCE_PUSH = deny('Plain force-push is blocked. Use --force-with-lease on a feature branch.');
const FORCE_MAIN = deny('Force-pushing main/master is blocked.');
const REMOTE_DELETE = deny('Deleting or mirroring remote branches is blocked.');
const DISCARDS_WORK = ask('This discards work irreversibly. Confirm with the user.');
const OUTSIDE_REPO = ask('This git command can write files or read outside the repo. Confirm with the user.');
const GIT_ALIAS = ask('A git alias can hide what a command runs. Confirm with the user.');
const UNCHECKED = ask(
  'A variable or command output decides what this git command does. Confirm with the user.',
);

const hasExpansion = (word) => /[$`]/.test(word);
const HOOKS_PATH_SETTING = /core\.hookspath/i;
const ALIAS_SETTING = /^alias\./i;
const GLOBAL_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

const PUSH_VALUES = { short: 'o', long: ['--push-option', '--repo', '--receive-pack', '--exec'] };
const COMMIT_VALUES = {
  short: 'mFCct',
  long: '--message --file --author --date --template --reuse-message --reedit-message --fixup --squash'
    .concat(' --trailer --cleanup --pathspec-from-file')
    .split(' '),
};
const CHECKOUT_VALUES = { short: 'bB', long: ['--orphan'] };
const RESTORE_VALUES = { short: 's', long: ['--source'] };
const SWITCH_VALUES = { short: 'cC', long: ['--create', '--force-create', '--orphan'] };
const BRANCH_VALUES = { short: 'u', long: ['--set-upstream-to'] };
const CONFIG_VALUES = {
  short: 'f',
  long: ['--file', '--blob', '--type', '--default', '--comment', '--value'],
};

function globalOptions(args) {
  const configs = [];
  let index = 0;
  while (args[index]?.startsWith('-')) {
    const option = args[index];
    if (option === '-c' || option === '--config-env') configs.push(args[index + 1] ?? '');
    if (option.startsWith('--config-env=')) configs.push(option.slice('--config-env='.length));
    index += GLOBAL_VALUE_OPTIONS.has(option) ? 2 : 1;
  }
  return { configs, subcommand: args[index] ?? '', rest: args.slice(index + 1) };
}

function targetsMainBranch(refspec) {
  const destination = refspec.slice(refspec.lastIndexOf(':') + 1).replace(/^\+?(refs\/heads\/)?/, '');
  return destination === 'main' || destination === 'master';
}

function forcesMainBranch(options, refspecs) {
  const leased = hasLong(options, '--force-with-lease', 9) || hasLong(options, '--force-if-includes', 9);
  const leasedRefs = options.values
    .filter(([name]) => name.startsWith('--force-with'))
    .map(([, value]) => value.split(':')[0]);
  return leased && [...refspecs, ...leasedRefs].some(targetsMainBranch);
}

function deletesRemote(options, refspecs) {
  const deleting =
    options.short.has('d') || hasLong(options, '--delete', 4) || hasLong(options, '--mirror', 4);
  return deleting || refspecs.some((refspec) => refspec.startsWith(':'));
}

function judgePush(options) {
  const refspecs = [...options.operands, ...options.afterDashes];
  const forced = options.short.has('f') || options.long.has('--force');
  if (forced || refspecs.some((refspec) => refspec.startsWith('+'))) return FORCE_PUSH;
  if (deletesRemote(options, refspecs)) return REMOTE_DELETE;
  if (forcesMainBranch(options, refspecs)) return FORCE_MAIN;
  return refspecs.some(hasExpansion) ? UNCHECKED : null;
}

function judgeCommit(options, command) {
  if (options.short.has('n')) return NO_VERIFY;
  if (command.assignments.includes('HUSKY=0')) return HUSKY_OFF;
  return command.assignments.some((assignment) => /^HUSKY=.*[$`]/.test(assignment)) ? UNCHECKED : null;
}

function setsKey(operands, key) {
  const at = operands.findIndex((operand) => key.test(operand));
  return at !== -1 && at < operands.length - 1;
}

function judgeConfig({ operands }) {
  if (setsKey(operands, HOOKS_PATH_SETTING)) return HOOKS_PATH;
  if (setsKey(operands, ALIAS_SETTING)) return GIT_ALIAS;
  return operands.slice(0, -1).some(hasExpansion) ? UNCHECKED : null;
}

const judgeReset = (options) => (hasLong(options, '--hard', 4) ? DISCARDS_WORK : null);
const judgeClean = (options) =>
  options.short.has('f') || hasLong(options, '--force', 3) ? DISCARDS_WORK : null;
const judgeStash = ({ operands }) => (['drop', 'clear'].includes(operands[0]) ? DISCARDS_WORK : null);
const judgeOutput = (options) =>
  options.long.has('--output') || options.long.has('--no-index') ? OUTSIDE_REPO : null;

function judgeCheckout(options) {
  const forced = options.short.has('f') || options.long.has('--force');
  const discardsPaths = options.afterDashes.length > 0 || options.operands.includes('.');
  return forced || discardsPaths ? DISCARDS_WORK : null;
}

function judgeRestore(options) {
  const staged = options.short.has('S') || hasLong(options, '--staged', 5);
  const worktree = options.short.has('W') || hasLong(options, '--worktree', 4);
  return staged && !worktree ? null : DISCARDS_WORK;
}

function judgeSwitch(options) {
  const discards =
    options.short.has('f') || options.long.has('--force') || hasLong(options, '--discard-changes', 4);
  const recreates = options.short.has('C') || hasLong(options, '--force-create', 9);
  return discards || recreates ? DISCARDS_WORK : null;
}

function judgeBranch(options) {
  const forced = ['D', 'f', 'M', 'C'].some((flag) => options.short.has(flag)) || options.long.has('--force');
  return forced ? DISCARDS_WORK : null;
}

const SUBCOMMANDS = new Map([
  ['push', { judge: judgePush, values: PUSH_VALUES }],
  ['commit', { judge: judgeCommit, values: COMMIT_VALUES }],
  ['reset', { judge: judgeReset }],
  ['clean', { judge: judgeClean, values: { short: 'e' } }],
  ['checkout', { judge: judgeCheckout, values: CHECKOUT_VALUES }],
  ['restore', { judge: judgeRestore, values: RESTORE_VALUES }],
  ['switch', { judge: judgeSwitch, values: SWITCH_VALUES }],
  ['branch', { judge: judgeBranch, values: BRANCH_VALUES }],
  ['stash', { judge: judgeStash }],
  ['diff', { judge: judgeOutput }],
  ['log', { judge: judgeOutput }],
  ['show', { judge: judgeOutput }],
  ['config', { judge: judgeConfig, values: CONFIG_VALUES }],
]);

/** Judges a git invocation: hook bypasses, destructive pushes, and commands that discard work or escape the repo. */
export function gitRule(command) {
  const { configs, subcommand, rest } = globalOptions(command.args);
  const skipsHooks = [...configs, ...command.assignments].some((setting) => HOOKS_PATH_SETTING.test(setting));
  if (skipsHooks) return HOOKS_PATH;
  if (configs.some((setting) => ALIAS_SETTING.test(setting))) return GIT_ALIAS;
  if (configs.some(hasExpansion)) return UNCHECKED;
  const rule = SUBCOMMANDS.get(subcommand);
  const options = parseOptions(rest, rule?.values);
  if (hasLong(options, '--no-verify', 6)) return NO_VERIFY;
  return rule ? rule.judge(options, command) : null;
}
