import { guardFileMatch, type SegmentMatch } from '../guard-files.js';
import type { Command } from '../shell/commands.js';
import { readFindExpression } from '../shell/find-expression.js';
import { hasExpansion } from '../shell/syntax.js';
import { unwrap } from '../shell/wrappers.js';
import { type OptionSpec, parseOptions } from './cli-options.js';
import { absoluteTargets, holdsProtectedDir, portablePath, resolveSegments } from './dangerous-paths.js';
import { globMatches } from './glob-match.js';
import type { JudgeContext } from './judge-context.js';
import { ask, type Verdict } from './verdicts.js';

const GUARD_FILES_CHANGED = ask(
  'This command changes the guards themselves (.claude/hooks, Claude Code settings or the project config). Confirm with the user.',
);
const PROJECT_REPLACED = ask(
  'This command moves or overwrites the home or project folder, or a folder above one, which holds the guards. Confirm with the user.',
);
const CHANGERS: ReadonlySet<string> = new Set([
  ...['rm', 'unlink', 'rmdir', 'shred', 'mv', 'tee', 'truncate'],
  ...['touch', 'dd', 'chmod', 'chown', 'chgrp'],
]);
const RSYNC_VALUES: OptionSpec = {
  short: 'efTBM',
  long: [
    ...['--rsh', '--exclude', '--include', '--filter', '--exclude-from', '--include-from', '--files-from'],
    ...['--temp-dir', '--backup-dir', '--log-file', '--partial-dir', '--compare-dest', '--copy-dest'],
    ...['--link-dest', '--suffix', '--rsync-path', '--remote-option', '--block-size', '--password-file'],
    ...['--out-format', '--log-file-format', '--chmod', '--chown', '--usermap', '--groupmap'],
    ...['--max-size', '--min-size', '--timeout', '--contimeout', '--bwlimit', '--port', '--sockopts'],
  ],
};
// Copiers write only their destination: the last operand, or the folder -t names.
const COPIERS: ReadonlyMap<string, OptionSpec> = new Map([
  ['cp', { short: 'tS', long: ['--target-directory', '--suffix'] }],
  ['ln', { short: 'tS', long: ['--target-directory', '--suffix'] }],
  ['install', { short: 'tSmog', long: ['--target-directory', '--suffix', '--mode', '--owner', '--group'] }],
  ['rsync', RSYNC_VALUES],
]);
const IN_PLACE_EDITORS: ReadonlySet<string> = new Set(['sed', 'gsed', 'perl', 'ruby']);
const IN_PLACE = /^(?:-[a-z]*i|--in-place(?:=|$))/i;
const TARGET_DIRECTORY = new Set(['-t', '--target-directory']);

// A glob segment such as `*` does not match a dot file, as in every shell without dotglob.
const segmentMatches: SegmentMatch = (actual, protectedSegment) =>
  actual === protectedSegment ||
  (/[*?[]/.test(actual) &&
    (actual.startsWith('.') || !protectedSegment.startsWith('.')) &&
    globMatches(actual, protectedSegment));

// `ln <target>` with no destination links into the current folder under the target's own name.
function copyDestination(program: string, args: readonly string[], spec: OptionSpec): string[] {
  const options = parseOptions(args, spec);
  const named = options.values.filter(([name]) => TARGET_DIRECTORY.has(name)).map(([, value]) => value);
  const operands = [...options.operands, ...options.afterDashes];
  const [only] = operands;
  if (named.length > 0 || only === undefined) return named;
  const linksHere = program === 'ln' && operands.length === 1;
  return [linksHere ? (only.replace(/\/+$/, '').split('/').at(-1) ?? only) : (operands.at(-1) ?? only)];
}

// find with -delete, or an -exec that deletes, moves or changes files, writes everything under its starting folders.
function findWrites(args: readonly string[]): string[] {
  const { roots, tokens } = readFindExpression(args);
  const writes = tokens.some(
    (token) => token === '-delete' || (typeof token === 'object' && CHANGERS.has(unwrap(token.exec).program)),
  );
  return writes ? roots : [];
}

function writtenArgs({ program, args }: Command): string[] {
  const copier = COPIERS.get(program);
  if (copier !== undefined) return copyDestination(program, args, copier);
  if (program === 'find') return findWrites(args);
  const named =
    CHANGERS.has(program) || (IN_PLACE_EDITORS.has(program) && args.some((arg) => IN_PLACE.test(arg)));
  return named ? args.map((arg) => arg.replace(/^of=/, '')) : [];
}

// mv takes its sources away, and rsync makes its destination match the source, so either may take the project's
// .claude folder with it.
function replacedFolders({ program, args }: Command): string[] {
  if (program === 'rsync') return copyDestination(program, args, COPIERS.get('rsync') ?? {});
  if (program !== 'mv') return [];
  const options = parseOptions(args, { short: 'tS', long: ['--target-directory', '--suffix'] });
  const operands = [...options.operands, ...options.afterDashes];
  return options.values.some(([name]) => TARGET_DIRECTORY.has(name)) ? operands : operands.slice(0, -1);
}

function namesGuardFile(word: string, context: JudgeContext): boolean {
  if (hasExpansion(word)) return false;
  const own = resolveSegments(portablePath(word)).map((segment) => segment.toLowerCase());
  return [own, ...absoluteTargets(word, context.paths)].some(
    (segments) => guardFileMatch(segments, segmentMatches) !== null,
  );
}

/**
 * Asks before a command writes, moves or deletes a hook bundle, a Claude Code settings file or the kit's config, or
 * a folder that holds one, the project folder and those above it included: a missing or emptied bundle makes `node`
 * fail, which Claude Code does not block on.
 */
export function guardFilesRule(command: Command, context: JudgeContext): Verdict | null {
  const written = [...writtenArgs(command), ...command.outputs];
  if (written.some((word) => namesGuardFile(word, context))) return GUARD_FILES_CHANGED;
  return replacedFolders(command).some((word) => holdsProtectedDir(word, context.paths))
    ? PROJECT_REPLACED
    : null;
}
