import { parseOptions } from './cli-options.mjs';
import { findPipedToRm, findRule, rmRule } from './delete-rules.mjs';
import { isEnvFileName, isEnvTemplateName } from './env-files.mjs';
import { gitRule, HOOKS_PATH, HUSKY_OFF } from './git-rules.mjs';
import { globMatches } from './glob-match.mjs';
import { parseCommands } from './shell-commands.mjs';
import { ask, deny, strictest } from './verdicts.mjs';

const UNKNOWN_PROGRAM = ask('The command name comes from an unquoted expansion. Confirm with the user.');
const UNCHECKED_VALUE = ask(
  'A variable or command output decides what this command does. Confirm with the user.',
);
const PIPE_TO_SHELL = deny('Piping a download into a shell is blocked. Download, review, then run.');
const GITHUB_DELETE = deny('Deleting repositories, releases or other GitHub resources is blocked.');
const WORLD_WRITABLE = deny('World-writable permissions are blocked.');
const SECRETS_FILE = ask('This command touches a secrets file (.env). Confirm with the user.');
const PIPED_SCRIPT = ask(
  'This pipes generated text into a shell, so it cannot be checked. Confirm with the user.',
);
const PUBLISH = ask('Publishing to a package registry is outward-facing. Confirm with the user.');
const SUDO = ask('sudo needs explicit user approval.');

const DOWNLOADERS = new Set(['curl', 'wget']);
const INTERPRETER =
  /^(?:sh|bash|zsh|dash|ksh|mksh|fish|python[\d.]*|node|nodejs|perl|ruby|php|eval|source|\.)$/;
const PUBLISH_COMMANDS = new Set(['publish', 'pub', 'unpublish', 'deprecate', 'dist-tag']);
const PRIVILEGED = new Set(['sudo', 'doas', 'su']);
const ENV_FILE_NAMES = ['.env', '.envrc', '.env.local', '.env.production', '.env.development'];
const HOOKS_PATH_SETTING = /core\.hookspath/i;
const HOOK_SETTING_VALUE = /^(?:HUSKY|GIT_CONFIG_\w+)=.*[$`]/;
const hasExpansion = (word) => /[$`]/.test(word);

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
  const path = word.replace(/\/+$/, '');
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf(':'), path.lastIndexOf('=')) + 1);
  const lower = name.toLowerCase();
  if (isEnvTemplateName(lower)) return false;
  if (isEnvFileName(lower)) return true;
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

const SHELL = /^(?:sh|bash|zsh|dash|ksh|mksh|fish)$/;
const CODE_FLAGS = [
  [SHELL, ['-c']],
  [/^python[\d.]*$/, ['-c', '-m']],
  [/^(?:node|nodejs)$/, ['-e', '--eval', '-p', '--print']],
  [/^perl$/, ['-e', '-E']],
  [/^ruby$/, ['-e']],
  [/^php$/, ['-r']],
];
const codeFlagsFor = (program) => CODE_FLAGS.find(([pattern]) => pattern.test(program))?.[1] ?? [];
const STDIN_PATHS = new Set(['-', '/dev/stdin', '/proc/self/fd/0']);

const EXECUTES_INPUT =
  /\b(?:exec|eval|system|popen|spawn|execSync|child_process|Function|compile|__import__|subprocess)\b/;

// Piped data stays data only with a leading script path, a module, or inline code that cannot execute input.
function runsStdinAsCode({ program, args, dynamicProgram, subs }) {
  if (dynamicProgram || subs.length > 0 || ['eval', 'source', '.'].includes(program)) return true;
  if (args.includes('-s') || args.some((arg) => EXECUTES_INPUT.test(arg))) return true;
  if (args.some((arg) => codeFlagsFor(program).includes(arg))) return false;
  const [first] = args;
  return first === undefined || first.startsWith('-') || STDIN_PATHS.has(first) || !/[./]/.test(first);
}

function downloadPipedToInterpreter(commands) {
  const earliestDownload = new Map();
  for (const { pipes } of commands.filter((command) => DOWNLOADERS.has(command.program))) {
    for (const { pipeline, stage } of pipes) {
      earliestDownload.set(pipeline, Math.min(stage, earliestDownload.get(pipeline) ?? Infinity));
    }
  }
  const fed = ({ pipes }) =>
    pipes.some(({ pipeline, stage }) => (earliestDownload.get(pipeline) ?? Infinity) < stage);
  const executesDownload = (command) => isInterpreter(command) && runsStdinAsCode(command) && fed(command);
  return commands.some(executesDownload) ? PIPE_TO_SHELL : null;
}

const MAX_SCRIPT_DEPTH = 3;
const sameStage = (pipe, pipeline, stage) => pipe.pipeline === pipeline && pipe.stage === stage;
const producerOf = (commands, { pipeline, stage }) =>
  commands.find((command) => command.pipes.some((pipe) => sameStage(pipe, pipeline, stage - 1)));

function scriptFedBy(producer) {
  if (producer.heredocs.length > 0) return producer.heredocs.join('\n');
  return ['echo', 'printf'].includes(producer.program) ? producer.args.join(' ') : null;
}

// A shell that reads its program from a pipe runs whatever the previous stage prints, so judge that text too.
function pipedScriptVerdict(commands, depth) {
  const shells = commands.filter((command) => SHELL.test(command.program) && runsStdinAsCode(command));
  const verdicts = shells.flatMap((shell) =>
    shell.pipes
      .filter((pipe) => pipe.stage > 0)
      .map((pipe) => {
        const producer = producerOf(commands, pipe);
        const script = producer ? scriptFedBy(producer) : null;
        if (script === null || depth >= MAX_SCRIPT_DEPTH) return PIPED_SCRIPT;
        return judgeAt(parseCommands(script), depth + 1);
      }),
  );
  return strictest(verdicts);
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

function judgeAt(commands, depth) {
  const verdicts = commands.flatMap((command) => rulesFor(command).map((rule) => rule(command)));
  verdicts.push(
    downloadPipedToInterpreter(commands),
    pipedScriptVerdict(commands, depth),
    findPipedToRm(commands),
  );
  return strictest(verdicts);
}

/** Judges parsed commands and returns the strictest verdict ({decision, reason}, deny beats ask) or null. */
export function judgeCommands(commands) {
  return judgeAt(commands, 0);
}
