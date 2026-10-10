import path from 'node:path';
import { isInside, realOrUndefined } from '../hooks/runtime/project.js';
import { findProgram, runProgram, type ToolRun } from '../hooks/runtime/tools.js';

/**
 * What git says about a project folder: nothing to commit, uncommitted changes, no repository, a folder its
 * repository ignores, no answer, or a repository whose own config sets a filter program, which init does not ask.
 */
export type GitState = 'clean' | 'dirty' | 'not-a-repo' | 'ignored' | 'unknown' | 'filters';

// No fsmonitor, so a repository's config cannot start its fsmonitor hook; no optional locks, so git writes nothing.
const SAFE = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];
const FILTER_PROGRAMS = String.raw`^filter\..*\.(clean|process)$`;

// Programs git starts come only from absolute PATH folders outside the project too.
function trustedPath(root: string): string[] {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.replace(/^"(.*)"$/, '$1'))
    .filter((entry) => path.isAbsolute(entry))
    .filter((entry) => {
      const real = realOrUndefined(entry);
      return real !== undefined && !isInside(root, real);
    });
}

// A git hook or `rebase --exec` exports GIT_DIR and friends, which would point git at another repository than the
// project's; git's messages stay English, so a missing repository reads the same in every locale.
function gitEnv(folders: readonly string[]): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !/^(?:GIT_|PATH$)/i.test(name));
  return { ...Object.fromEntries(kept), PATH: folders.join(path.delimiter), LC_ALL: 'C' };
}

function gitRunner(root: string): ((args: readonly string[]) => ToolRun) | undefined {
  const rootReal = realOrUndefined(root) ?? root;
  const folders = trustedPath(rootReal);
  const git = findProgram('git', rootReal, folders.join(path.delimiter));
  if (git === undefined) return undefined;
  const env = gitEnv(folders);
  return (args) => runProgram(git, [...SAFE, ...args], { cwd: root, env });
}

// status runs a filter's program on a changed file, and a repository that arrives with its .git folder (a zip) can
// set one in its own or a submodule's config, which status never enters; global and system config are the user's.
function setsFilterProgram(git: (args: readonly string[]) => ToolRun): boolean | undefined {
  const config = git(['config', '--show-scope', '--get-regexp', FILTER_PROGRAMS]);
  if (config.status === 1) return false;
  if (config.status !== 0) return undefined;
  return config.stdout.split('\n').some((line) => /^(?:local|worktree)\t/.test(line));
}

/**
 * Asks git, with no shell and no network, whether it can show and undo what init changes in `root` (#27): the
 * status of that folder alone, so a change elsewhere in a monorepo does not count, and whether the repository
 * ignores the folder, which git then cannot track. Git is found only in absolute PATH folders outside the
 * project, is not asked about a repository whose own config sets a filter program (`filters`), and never looks
 * inside submodules. A missing git or any other failure is `unknown`.
 */
export function gitState(root: string): GitState {
  const git = gitRunner(root);
  if (git === undefined) return 'unknown';
  const filters = setsFilterProgram(git);
  if (filters !== false) return filters === true ? 'filters' : 'unknown';
  const status = git(['status', '--porcelain', '--ignore-submodules=all', '--', '.']);
  if (status.status !== 0) return /not a git repository/i.test(status.stderr) ? 'not-a-repo' : 'unknown';
  if (status.stdout.trim() !== '') return 'dirty';
  const ignored = git(['check-ignore', '-q', '--', '.']).status;
  if (ignored === 0) return 'ignored';
  return ignored === 1 ? 'clean' : 'unknown';
}
