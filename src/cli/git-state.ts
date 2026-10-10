import { spawnSync } from 'node:child_process';

/**
 * What git says about a project folder: nothing to commit, uncommitted changes, no repository, a folder its
 * repository ignores, or no answer.
 */
export type GitState = 'clean' | 'dirty' | 'not-a-repo' | 'ignored' | 'unknown';

// No fsmonitor, so a repository's config cannot make git run a program; no optional locks, so it writes nothing.
const SAFE = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];

// A git hook or `rebase --exec` exports GIT_DIR and friends, which would point git at another repository than the
// project's; git's messages stay English, so a missing repository reads the same in every locale.
function gitEnv(): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name));
  return { ...Object.fromEntries(kept), LC_ALL: 'C' };
}

function git(
  root: string,
  args: readonly string[],
): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync('git', [...SAFE, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    env: gitEnv(),
  });
  return { status: run.error === undefined ? run.status : null, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Asks git, with no shell and no network, whether it can show and undo what init changes in `root` (#27): the
 * status of that folder alone, so a change elsewhere in a monorepo does not count, and whether the repository
 * ignores the folder, which git then cannot track. A missing git or any other failure is `unknown`.
 */
export function gitState(root: string): GitState {
  const status = git(root, ['status', '--porcelain', '--', '.']);
  if (status.status !== 0) return /not a git repository/i.test(status.stderr) ? 'not-a-repo' : 'unknown';
  if (status.stdout.trim() !== '') return 'dirty';
  const ignored = git(root, ['check-ignore', '-q', '--', '.']).status;
  if (ignored === 0) return 'ignored';
  return ignored === 1 ? 'clean' : 'unknown';
}
