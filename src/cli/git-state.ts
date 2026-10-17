import { gitRunner, setsFilterProgram } from '../hooks/runtime/git.js';

/**
 * What git says about a project folder: nothing to commit, uncommitted changes, no repository, a folder its
 * repository ignores, no answer, or a repository whose own config sets a filter program, which init does not ask.
 */
export type GitState = 'clean' | 'dirty' | 'not-a-repo' | 'ignored' | 'unknown' | 'filters';

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
