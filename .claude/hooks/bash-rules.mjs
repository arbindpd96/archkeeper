import { hasLong, parseOptions } from './cli-options.mjs';
import { isDangerousPath, isUncheckedPath } from './dangerous-paths.mjs';
import { gitRule, HOOKS_PATH, HUSKY_OFF } from './git-rules.mjs';
import { globMatches } from './glob-match.mjs';

const deny = (reason) => Object.freeze({ decision: 'deny', reason });
const ask = (reason) => Object.freeze({ decision: 'ask', reason });

const DANGEROUS_DELETE = deny('Recursive delete of a root, home or whole-directory path is blocked.');
const UNSEEN_DELETE = ask(
  'Recursive delete of paths from a variable, command output, xargs or find cannot be checked. Confirm with the user.',
);
const UNKNOWN_PROGRAM = ask('The command name comes from an unquoted expansion. Confirm with the user.');
const UNCHECKED_VALUE = ask(
  'A variable or command output decides what this command does. Confirm with the user.',
);
const PIPE_TO_SHELL = deny('Piping a download into a shell is blocked. Download, review, then run.');
const GITHUB_DELETE = deny('Deleting repositories, releases or other GitHub resources is blocked.');
const WORLD_WRITABLE = deny('World-writable permissions are blocked.');
const SECRETS_FILE = ask('This command reads a secrets file (.env). Confirm with the user.');
const PUBLISH = ask('Publishing to a package registry is outward-facing. Confirm with the user.');
const SUDO = ask('sudo needs explicit user approval.');

const DOWNLOADERS = new Set(['curl', 'wget']);
const INTERPRETER =
  /^(?:sh|bash|zsh|dash|ksh|mksh|fish|python[\d.]*|node|nodejs|perl|ruby|php|eval|source|\.)$/;
const PUBLISH_COMMANDS = new Set(['publish', 'pub', 'unpublish', 'deprecate', 'dist-tag']);
const PRIVILEGED = new Set(['sudo', 'doas', 'su']);
const ENV_FILE = /^\.env(?:rc|\..+)?$/i;
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template)$/i;
const ENV_FILE_NAMES = ['.env', '.envrc', '.env.local', '.env.production', '.env.development'];
const HOOKS_PATH_SETTING = /core\.hookspath/i;
const HOOK_SETTING_VALUE = /^(?:HUSKY|GIT_CONFIG_\w+)=.*[$`]/;
const FIND_NAME_FILTERS = new Set(
  '-name -iname -path -ipath -wholename -iwholename -regex -iregex -lname -ilname'.split(' '),
);
const FIND_LOGIC = new Set(['-o', '-or', '!', '-not']);
const hasExpansion = (word) => /[$`]/.test(word);

const isRecursive = (options) =>
  options.short.has('r') || options.short.has('R') || hasLong(options, '--recursive', 3);

function rmRule({ args, wrappers, splitArgs }) {
  const options = parseOptions(args);
  const recursive = isRecursive(options);
  const targets = [...options.operands, ...options.afterDashes];
  // An unquoted expansion such as `rm $FLAGS /` may supply -r at run time, so a dangerous target is enough.
  if ((recursive || splitArgs) && targets.some(isDangerousPath)) return DANGEROUS_DELETE;
  const unseen = targets.some(isUncheckedPath) || wrappers.includes('xargs') || wrappers.includes('find');
  return recursive && unseen ? UNSEEN_DELETE : null;
}

function findRoots(args) {
  let index = 0;
  while (/^-(?:[HLP]|O\d*|D)$/.test(args[index] ?? '')) index += args[index] === '-D' ? 2 : 1;
  const roots = [];
  for (; index < args.length && !/^[-(!)]/.test(args[index]); index += 1) roots.push(args[index]);
  return roots.length > 0 ? roots : ['.'];
}

// A name filter narrows a delete only if it has literal text and the expression has no -o or negation.
const isNarrowingPattern = (pattern) =>
  !/[$`]/.test(pattern) && pattern.replace(/\[[^\]]*\]|[*?]/g, '') !== '';

function findRule({ args }) {
  const roots = findRoots(args);
  if (!args.includes('-delete')) return null;
  if (roots.some(isUncheckedPath)) return UNSEEN_DELETE;
  if (!roots.some(isDangerousPath)) return null;
  const narrowed =
    !args.some((arg) => FIND_LOGIC.has(arg)) &&
    args.some((arg, i) => FIND_NAME_FILTERS.has(arg) && isNarrowingPattern(args[i + 1] ?? ''));
  return narrowed ? null : DANGEROUS_DELETE;
}

function isWorldWritable(mode) {
  if (/^[0-7]{1,4}$/.test(mode)) return (parseInt(mode, 8) & 0o002) !== 0;
  return mode.split(',').some((clause) => {
    const who = /^[ugoa]*/.exec(clause)[0];
    return /[oa]/.test(who) && /[+=][^-+=]*w/.test(clause.slice(who.length));
  });
}

function chmodRule({ args }) {
  const { operands, afterDashes } = parseOptions(args);
  const mode = [...operands, ...afterDashes][0] ?? '';
  if (hasExpansion(mode)) return UNCHECKED_VALUE;
  return isWorldWritable(mode) ? WORLD_WRITABLE : null;
}

function ghRule({ args }) {
  const valueOptions = { short: 'RXHfFqtp', long: ['--repo', '--method', '--header', '--field', '--jq'] };
  const { operands, values } = parseOptions(args, valueOptions);
  const [group = '', action = ''] = operands;
  const methods = values.filter(([name]) => name === '-X' || name === '--method').map(([, value]) => value);
  if ([group, action, ...methods].some(hasExpansion)) return UNCHECKED_VALUE;
  const deletesResource = (group === 'repo' || group === 'release') && action === 'delete';
  const methodDelete = methods.some((method) => method.toUpperCase() === 'DELETE');
  return deletesResource || (group === 'api' && methodDelete) ? GITHUB_DELETE : null;
}

const publishRule = ({ args }) => (args.some((arg) => PUBLISH_COMMANDS.has(arg)) ? PUBLISH : null);

function environmentRule({ args, assignments }) {
  const settings = [...args, ...assignments];
  if (settings.includes('HUSKY=0')) return HUSKY_OFF;
  if (settings.some((setting) => HOOKS_PATH_SETTING.test(setting))) return HOOKS_PATH;
  return settings.some((setting) => HOOK_SETTING_VALUE.test(setting)) ? UNCHECKED_VALUE : null;
}

function envGlobMatches(name) {
  const suffix = name.slice(name.lastIndexOf('.') + 1).replace(/[*?[\]!^\\]/g, '');
  return [...ENV_FILE_NAMES, `.env.${suffix}`].some((file) => globMatches(name, file));
}

function isEnvFile(word) {
  const name = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf(':'), word.lastIndexOf('=')) + 1);
  const lower = name.toLowerCase();
  if (ENV_TEMPLATE.test(lower)) return false;
  if (ENV_FILE.test(lower)) return true;
  return lower.startsWith('.') && /[*?[]/.test(lower) && envGlobMatches(lower);
}

// A program name built from an expansion ($x, $(...)) is unknown, so it is judged as any program could be.
const isInterpreter = ({ program, dynamicProgram }) => dynamicProgram || INTERPRETER.test(program);

const secretsFileRule = (command) =>
  [...command.args, ...command.redirects].some(isEnvFile) ? SECRETS_FILE : null;
const sudoRule = ({ wrappers }) => (wrappers.some((wrapper) => PRIVILEGED.has(wrapper)) ? SUDO : null);
const unknownProgramRule = ({ splitProgram }) => (splitProgram ? UNKNOWN_PROGRAM : null);
const runsDownload = (command) =>
  isInterpreter(command) && command.subs.some((sub) => DOWNLOADERS.has(sub.program)) ? PIPE_TO_SHELL : null;

function downloadPipedToInterpreter(commands) {
  const earliestDownload = new Map();
  for (const { pipes } of commands.filter((command) => DOWNLOADERS.has(command.program))) {
    for (const { pipeline, stage } of pipes) {
      earliestDownload.set(pipeline, Math.min(stage, earliestDownload.get(pipeline) ?? Infinity));
    }
  }
  const fed = ({ pipes }) =>
    pipes.some(({ pipeline, stage }) => (earliestDownload.get(pipeline) ?? Infinity) < stage);
  return commands.some((command) => isInterpreter(command) && fed(command)) ? PIPE_TO_SHELL : null;
}

const PROGRAM_RULES = new Map([
  ['rm', rmRule],
  ['find', findRule],
  ['git', gitRule],
  ['chmod', chmodRule],
  ['gh', ghRule],
  ...['npm', 'pnpm', 'yarn', 'bun'].map((program) => [program, publishRule]),
  ...['', 'export', 'declare', 'typeset', 'readonly', 'local'].map((program) => [program, environmentRule]),
]);
const ANY_PROGRAM_RULES = [...new Set(PROGRAM_RULES.values())];
const COMMAND_RULES = [sudoRule, secretsFileRule, runsDownload, unknownProgramRule];

function rulesFor(command) {
  if (command.dynamicProgram) return [...ANY_PROGRAM_RULES, ...COMMAND_RULES];
  const programRule = PROGRAM_RULES.get(command.program);
  return programRule ? [programRule, ...COMMAND_RULES] : COMMAND_RULES;
}

/** Judges parsed commands and returns the strictest verdict ({decision, reason}, deny beats ask) or null. */
export function judgeCommands(commands) {
  const verdicts = commands.flatMap((command) => rulesFor(command).map((rule) => rule(command)));
  verdicts.push(downloadPipedToInterpreter(commands));
  const found = verdicts.filter(Boolean);
  return found.find((verdict) => verdict.decision === 'deny') ?? found[0] ?? null;
}
