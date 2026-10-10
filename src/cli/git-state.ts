import { spawnSync } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * What git says about a project folder: nothing to commit, uncommitted changes, no repository, a folder its
 * repository ignores, no answer, or a repository whose own config sets a filter program, which init does not ask.
 */
export type GitState = 'clean' | 'dirty' | 'not-a-repo' | 'ignored' | 'unknown' | 'filters';

// No fsmonitor, so a repository's config cannot start its fsmonitor hook; no optional locks, so git writes nothing.
const SAFE = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];
const GIT_FILE = process.platform === 'win32' ? 'git.exe' : 'git';
const FILTER_PROGRAMS = String.raw`^filter\..*\.(clean|process)$`;

interface GitRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function isInside(root: string, real: string): boolean {
  const relative = path.relative(root, real);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realOrUndefined(absolute: string): string | undefined {
  try {
    return realpathSync.native(absolute);
  } catch {
    return undefined;
  }
}

// Windows looks for a bare `git` in the child's working folder before PATH, and an empty or relative PATH entry
// means that folder on POSIX, so a project that ships git.exe or git would run. Only absolute folders outside the
// project count, for finding git and for any program git itself starts.
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

function isProgram(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function gitProgram(root: string, folders: readonly string[]): string | undefined {
  return folders
    .map((folder) => path.join(folder, GIT_FILE))
    .find((file) => isProgram(file) && !isInside(root, realOrUndefined(file) ?? root));
}

// A git hook or `rebase --exec` exports GIT_DIR and friends, which would point git at another repository than the
// project's; git's messages stay English, so a missing repository reads the same in every locale.
function gitEnv(folders: readonly string[]): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !/^(?:GIT_|PATH$)/i.test(name));
  return { ...Object.fromEntries(kept), PATH: folders.join(path.delimiter), LC_ALL: 'C' };
}

function gitRunner(root: string): ((args: readonly string[]) => GitRun) | undefined {
  const rootReal = realOrUndefined(root) ?? root;
  const folders = trustedPath(rootReal);
  const git = gitProgram(rootReal, folders);
  if (git === undefined) return undefined;
  const env = gitEnv(folders);
  return (args) => {
    const run = spawnSync(git, [...SAFE, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      env,
    });
    return { status: run.error === undefined ? run.status : null, stdout: run.stdout, stderr: run.stderr };
  };
}

// git status runs a filter's clean or process program on a file whose stat data changed, and a repository that
// arrives with its .git folder, as in a zip, can set one in its own config; global and system config are the user's.
function setsFilterProgram(git: (args: readonly string[]) => GitRun): boolean | undefined {
  const config = git(['config', '--show-scope', '--get-regexp', FILTER_PROGRAMS]);
  if (config.status === 1) return false;
  if (config.status !== 0) return undefined;
  return config.stdout.split('\n').some((line) => /^(?:local|worktree)\t/.test(line));
}

/**
 * Asks git, with no shell and no network, whether it can show and undo what init changes in `root` (#27): the
 * status of that folder alone, so a change elsewhere in a monorepo does not count, and whether the repository
 * ignores the folder, which git then cannot track. Git is found only in absolute PATH folders outside the
 * project, and is not asked about a repository whose own config sets a filter program (`filters`). A missing git
 * or any other failure is `unknown`.
 */
export function gitState(root: string): GitState {
  const git = gitRunner(root);
  if (git === undefined) return 'unknown';
  const filters = setsFilterProgram(git);
  if (filters !== false) return filters === true ? 'filters' : 'unknown';
  const status = git(['status', '--porcelain', '--', '.']);
  if (status.status !== 0) return /not a git repository/i.test(status.stderr) ? 'not-a-repo' : 'unknown';
  if (status.stdout.trim() !== '') return 'dirty';
  const ignored = git(['check-ignore', '-q', '--', '.']).status;
  if (ignored === 0) return 'ignored';
  return ignored === 1 ? 'clean' : 'unknown';
}
