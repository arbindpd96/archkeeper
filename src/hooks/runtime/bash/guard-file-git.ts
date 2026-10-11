import { hasLong, type OptionSpec, parseOptions, type ParsedOptions } from './cli-options.js';
import { globalOptions } from './git-rules.js';
import type { PathContext } from './dangerous-paths.js';

const GIT_WRITERS: ReadonlyMap<string, OptionSpec> = new Map([
  ['rm', { long: ['--pathspec-from-file'] }],
  ['mv', {}],
  ['stash', { short: 'm', long: ['--message', '--pathspec-from-file'] }],
]);
const TOP = ':/';

// `git stash -u` or `-a` takes untracked files away, such as bundles not committed yet: those its paths name, or,
// with none named, every one, the tree's `.claude` folder included.
function stashedPaths(options: ParsedOptions): string[] {
  const [action = 'push', ...named] = options.operands;
  const untracked =
    options.short.has('u') ||
    options.short.has('a') ||
    hasLong(options, '--include-untracked', 5) ||
    hasLong(options, '--all', 4);
  if (!untracked || !['push', 'save'].includes(action)) return [];
  const paths = action === 'push' ? [...named, ...options.afterDashes] : options.afterDashes;
  return paths.length > 0 ? paths : [`${TOP}.claude`];
}

function changedPaths(subcommand: string, options: ParsedOptions): string[] {
  if (subcommand === 'stash') return stashedPaths(options);
  if (subcommand === 'rm' && hasLong(options, '--cached', 4)) return [];
  return [...options.operands, ...options.afterDashes];
}

// A path starting `:/` is git's pathspec from the top of the tree, which here is taken to be the project.
function fromWhereGitRuns(path: string, folder: string, paths: PathContext): string {
  if (path.startsWith(TOP)) return `${paths.project}/${path.slice(TOP.length)}`;
  return folder === '' || path.startsWith('/') ? path : `${folder}/${path}`;
}

/**
 * The paths a git command deletes, moves or takes away from the working tree: `git rm` without `--cached`,
 * both sides of `git mv`, and what `git stash -u` or `-a` stashes, each as seen from the folder the command runs in.
 */
export function gitWrittenPaths(args: readonly string[], paths: PathContext): string[] {
  const { folder, subcommand, rest } = globalOptions(args);
  const spec = GIT_WRITERS.get(subcommand);
  if (spec === undefined) return [];
  return changedPaths(subcommand, parseOptions(rest, spec)).map((path) =>
    fromWhereGitRuns(path, folder, paths),
  );
}
