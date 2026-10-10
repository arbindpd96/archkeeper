import { execFileSync } from 'node:child_process';

/** What git says about a project folder: nothing to commit, uncommitted changes, no repository, or no answer. */
export type GitState = 'clean' | 'dirty' | 'not-a-repo' | 'unknown';

// No fsmonitor, so a repository's config cannot make status run a program; no optional locks, so it writes nothing.
const STATUS = ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain'];

/**
 * Asks git, with `execFile` and no shell, whether `root` has uncommitted changes (#27). It touches no network. A
 * folder outside any repository is `not-a-repo`; a missing git or any other failure is `unknown`.
 */
export function gitState(root: string): GitState {
  try {
    const status = execFileSync('git', STATUS, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      // git's messages in English, so a missing repository reads the same in every locale.
      env: { ...process.env, LC_ALL: 'C' },
    });
    return status.trim() === '' ? 'clean' : 'dirty';
  } catch (error) {
    const { stderr } = error as { stderr?: unknown };
    return typeof stderr === 'string' && /not a git repository/i.test(stderr) ? 'not-a-repo' : 'unknown';
  }
}
