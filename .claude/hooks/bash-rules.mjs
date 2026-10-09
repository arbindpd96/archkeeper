import { parseOptions } from './cli-options.mjs';
import { findPipedToRm, findRule, rmRule } from './delete-rules.mjs';
import { isEnvFileName, isEnvTemplateName } from './env-files.mjs';
import { gitRule, HOOKS_PATH, HOOKS_PATH_SETTING, HUSKY_OFF } from './git-rules.mjs';
import { globMatches } from './glob-match.mjs';
import { interpreterVerdict } from './interpreter-rules.mjs';
import { PIPED_SCRIPT, pipedScriptVerdict } from './piped-scripts.mjs';
import { parseCommands } from './shell-commands.mjs';
import { hasExpansion } from './shell-syntax.mjs';
import { ShellSyntaxError } from './shell-words.mjs';
import { ask, deny, strictest } from './verdicts.mjs';

const UNKNOWN_PROGRAM = ask('The command name comes from an unquoted expansion. Confirm with the user.');
const UNCHECKED_VALUE = ask(
  'A variable or command output decides what this command does. Confirm with the user.',
);
const GITHUB_DELETE = deny('Deleting repositories, releases or other GitHub resources is blocked.');
const WORLD_WRITABLE = deny('World-writable permissions are blocked.');
const SECRETS_FILE = ask('This command touches a secrets file (.env). Confirm with the user.');
const PUBLISH = ask('Publishing to a package registry is outward-facing. Confirm with the user.');
const SUDO = ask('sudo needs explicit user approval.');

const PUBLISH_COMMANDS = new Set(['publish', 'pub', 'unpublish', 'deprecate', 'dist-tag']);
const PRIVILEGED = new Set(['sudo', 'doas', 'su']);
const ENV_FILE_NAMES = ['.env', '.envrc', '.env.local', '.env.production', '.env.development'];
const HOOK_SETTING = /^(?:HUSKY|GIT_CONFIG_\w+)=/;

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
  const hookSettingFromExpansion = (setting) => HOOK_SETTING.test(setting) && hasExpansion(setting);
  return settings.some(hookSettingFromExpansion) ? UNCHECKED_VALUE : null;
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

const secretsFileRule = (command) =>
  [...command.args, ...command.redirects].some(isEnvFile) ? SECRETS_FILE : null;
const sudoRule = ({ wrappers }) => (wrappers.some((wrapper) => PRIVILEGED.has(wrapper)) ? SUDO : null);
const unknownProgramRule = ({ splitProgram }) => (splitProgram ? UNKNOWN_PROGRAM : null);

const MAX_SCRIPT_DEPTH = 3;

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
const COMMAND_RULES = [sudoRule, secretsFileRule, unknownProgramRule];

function rulesFor(command) {
  if (command.dynamicProgram) return [...ANY_PROGRAM_RULES, ...COMMAND_RULES];
  const programRule = PROGRAM_RULES.get(command.program);
  return programRule ? [programRule, ...COMMAND_RULES] : COMMAND_RULES;
}

// Text piped into a shell, or its decoded form, may not parse; that text alone becomes unknown, and the
// verdicts on the rest of the command still count.
function judgeScriptAt(depth) {
  return (script) => {
    if (depth >= MAX_SCRIPT_DEPTH) return PIPED_SCRIPT;
    try {
      return judgeAt(parseCommands(script), depth + 1);
    } catch (error) {
      if (error instanceof ShellSyntaxError) return PIPED_SCRIPT;
      throw error;
    }
  };
}

function judgeAt(commands, depth) {
  const verdicts = commands.flatMap((command) => rulesFor(command).map((rule) => rule(command)));
  verdicts.push(
    interpreterVerdict(commands),
    pipedScriptVerdict(commands, judgeScriptAt(depth)),
    findPipedToRm(commands),
  );
  return strictest(verdicts);
}

/** Judges parsed commands and returns the strictest verdict ({decision, reason}, deny beats ask) or null. */
export function judgeCommands(commands) {
  return judgeAt(commands, 0);
}
