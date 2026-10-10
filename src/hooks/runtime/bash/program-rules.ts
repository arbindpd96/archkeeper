import { BRAND } from '../../../core/brand.js';
import { escapeUnprintable } from '../../../core/text.js';
import { isEnvFileName, isEnvTemplateName } from '../env-files.js';
import { configFile } from '../options.js';
import type { Command } from '../shell/commands.js';
import { hasExpansion } from '../shell/syntax.js';
import { commandName } from '../shell/wrappers.js';
import { parseOptions } from './cli-options.js';
import { globMatches } from './glob-match.js';
import { HUSKY_OFF } from './git-rules.js';
import type { JudgeContext, Rule } from './judge-context.js';
import { ask, deny, type Verdict } from './verdicts.js';

const UNKNOWN_PROGRAM = ask('The command name comes from an unquoted expansion. Confirm with the user.');
const UNCHECKED_VALUE = ask(
  'A variable or command output decides what this command does. Confirm with the user.',
);
const GITHUB_DELETE = deny('Deleting repositories, releases or other GitHub resources is blocked.');
const WORLD_WRITABLE = deny('World-writable permissions are blocked.');
const SECRETS_FILE = ask('This command touches a secrets file (.env). Confirm with the user.');
const PUBLISH = ask('Publishing to a package registry is outward-facing. Confirm with the user.');
const SUDO = ask('sudo needs explicit user approval.');

const PUBLISH_COMMANDS: ReadonlySet<string> = new Set([
  'publish',
  'pub',
  'unpublish',
  'deprecate',
  'dist-tag',
]);
const STAGE_ACTIONS: ReadonlySet<string> = new Set(['approve', 'reject']);
const PRIVILEGED: ReadonlySet<string> = new Set(['sudo', 'doas', 'su']);
const ENV_FILE_NAMES: readonly string[] = [
  '.env',
  '.envrc',
  '.env.local',
  '.env.production',
  '.env.development',
];
const GH_VALUES = { short: 'RXHfFqtp', long: ['--repo', '--method', '--header', '--field', '--jq'] };

function isWorldWritable(mode: string): boolean {
  if (/^[0-7]{1,4}$/.test(mode)) return (parseInt(mode, 8) & 0o002) !== 0;
  return mode.split(',').some((clause) => {
    const who = /^[ugoa]*/.exec(clause)?.[0] ?? '';
    return /[oa]/.test(who) && /[+=][^-+=]*w/.test(clause.slice(who.length));
  });
}

/** Judges `chmod`: world-writable modes are denied. */
export const chmodRule: Rule = ({ args }) => {
  const { operands, afterDashes } = parseOptions(args);
  const mode = [...operands, ...afterDashes][0] ?? '';
  if (hasExpansion(mode)) return UNCHECKED_VALUE;
  return isWorldWritable(mode) ? WORLD_WRITABLE : null;
};

/** Judges `gh`: deleting a repository or release, or any DELETE through the API, is denied. */
export const ghRule: Rule = ({ args }) => {
  const { operands, values } = parseOptions(args, GH_VALUES);
  const [group = '', action = ''] = operands;
  const methods = values.filter(([name]) => name === '-X' || name === '--method').map(([, value]) => value);
  if ([group, action, ...methods].some(hasExpansion)) return UNCHECKED_VALUE;
  const deletesResource = (group === 'repo' || group === 'release') && action === 'delete';
  const methodDelete = methods.some((method) => method.toUpperCase() === 'DELETE');
  return deletesResource || (group === 'api' && methodDelete) ? GITHUB_DELETE : null;
};

// `npm stage approve` and `reject` act on a staged publish; 2FA still gates them, but the guard surfaces them (#31).
/** Judges package managers: publishing, deprecating, retagging and approving a staged publish ask. */
export const publishRule: Rule = ({ args }) => {
  const publishes = args.some((arg) => PUBLISH_COMMANDS.has(arg));
  const stages = args.includes('stage') && args.some((arg) => STAGE_ACTIONS.has(arg));
  return publishes || stages ? PUBLISH : null;
};

/** Judges variable assignments: with `blockNoVerify`, turning husky off is denied. */
export const environmentRule: Rule = ({ args, assignments }, { options }) => {
  if (!options.blockNoVerify) return null;
  const settings = [...args, ...assignments];
  if (settings.includes('HUSKY=0')) return HUSKY_OFF;
  return settings.some((setting) => setting.startsWith('HUSKY=') && hasExpansion(setting))
    ? UNCHECKED_VALUE
    : null;
};

function envGlobMatches(name: string): boolean {
  const suffix = name.slice(name.lastIndexOf('.') + 1).replace(/[*?[\]!^\\]/g, '');
  return [...ENV_FILE_NAMES, `.env.${suffix}`].some((file) => globMatches(name, file));
}

function isEnvFile(word: string): boolean {
  const file = word.replace(/\/+$/, '');
  const name = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf(':'), file.lastIndexOf('=')) + 1);
  const lower = name.toLowerCase();
  if (isEnvTemplateName(lower)) return false;
  if (isEnvFileName(lower)) return true;
  return lower.startsWith('.') && /[*?[]/.test(lower) && envGlobMatches(lower);
}

/** Asks before any command that names a `.env`, `.env.*` or `.envrc` file at any depth, templates aside. */
export const secretsFileRule: Rule = (command) =>
  [...command.args, ...command.redirects].some(isEnvFile) ? SECRETS_FILE : null;

/** Asks before sudo, doas and su. */
export const sudoRule: Rule = ({ wrappers }) =>
  wrappers.some((wrapper) => PRIVILEGED.has(wrapper)) ? SUDO : null;

/** Asks when the program itself comes from an unquoted expansion. */
export const unknownProgramRule: Rule = ({ splitProgram }) => (splitProgram ? UNKNOWN_PROGRAM : null);

function matchesDenied(command: Command, denied: string): boolean {
  const [program = '', ...words] = denied.trim().split(/\s+/);
  if (program === '' || command.program !== commandName(program)) return false;
  let next = 0;
  for (const arg of command.args) if (arg === words[next]) next += 1;
  return next >= words.length;
}

/** Denies a command the project lists in `denyCommands`: its program, then its words in order among the arguments. */
export function denyCommandsRule(command: Command, { options }: JudgeContext): Verdict | null {
  const denied = options.denyCommands.find((entry) => matchesDenied(command, entry));
  if (denied === undefined) return null;
  const shown = escapeUnprintable(denied.trim());
  return deny(`"${shown}" is denied by options.safety.denyCommands in ${configFile(BRAND)}.`);
}
