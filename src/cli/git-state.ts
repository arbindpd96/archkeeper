import { gitRunner, unsafeForStatus } from '../hooks/runtime/git.js';

const LIST_BUDGET_MS = 5_000;
const LIST_MAX_BYTES = 32 * 1024 * 1024;
const FOLDER_PEEK_BYTES = 4096;

/**
 * What git says about a project folder: nothing to commit, uncommitted changes, no repository, a folder its
 * repository ignores, no answer, or a repository whose own config sets a filter program or a promisor remote, which
 * init does not ask.
 */
export type GitState = 'clean' | 'dirty' | 'not-a-repo' | 'ignored' | 'unknown' | 'filters';

/**
 * Asks git, with no shell and no network, whether it can show and undo what init changes in `root` (#27): the
 * status of that folder alone, so a change elsewhere in a monorepo does not count, and whether the repository
 * ignores the folder, which git then cannot track. Git is found only in absolute PATH folders outside the
 * project, is not asked about a repository whose own config sets a filter program or a partial clone's promisor
 * remote (`filters`), and never looks inside submodules. A missing git or any other failure is `unknown`.
 */
export function gitState(root: string): GitState {
  const git = gitRunner(root);
  if (git === undefined) return 'unknown';
  const unsafe = unsafeForStatus(git);
  if (unsafe !== false) return unsafe === true ? 'filters' : 'unknown';
  const status = git(['status', '--porcelain', '--ignore-submodules=all', '--', '.']);
  if (status.status !== 0) return /not a git repository/i.test(status.stderr) ? 'not-a-repo' : 'unknown';
  if (status.stdout.trim() !== '') return 'dirty';
  const ignored = git(['check-ignore', '-q', '--', '.']).status;
  if (ignored === 0) return 'ignored';
  return ignored === 1 ? 'clean' : 'unknown';
}

// `--stage` prints `<mode> <object> <stage>\t<path>`; a gitlink, mode 160000, is a submodule, which is a folder.
function stagedPath(entry: string): string {
  const file = entry.slice(entry.indexOf('\t') + 1);
  return entry.startsWith('160000 ') ? `${file}/` : file;
}

/**
 * The files git tracks in `root`, relative to it, which seed the architecture map (#36): `git ls-files -z --stage
 * -- .` through the same hardened runner, reading only the index, so it runs no filter program and fetches nothing,
 * and no name is quoted or split; a submodule ends with `/`, so the map lists it as the folder it is. Undefined when
 * git is missing, the folder is in no repository, git fails or takes over 5 seconds, or the list is over 32 MiB.
 */
export function trackedFiles(root: string): string[] | undefined {
  const listed = gitRunner(root, LIST_BUDGET_MS, LIST_MAX_BYTES)?.(['ls-files', '-z', '--stage', '--', '.']);
  if (listed?.status !== 0) return undefined;
  return listed.stdout
    .split('\0')
    .filter((entry) => entry !== '')
    .map(stagedPath);
}

/**
 * Which of these folders of `root`, such as `node_modules`, hold a file git tracks (#37, #38): `git ls-files` through
 * the same hardened runner, a folder at a time, its name matched in any case, as a case-insensitive file system
 * resolves it, and read only to its first names, so a repository that tracks a whole node_modules costs no more.
 * Undefined when git gives no answer.
 */
export function trackedFolders(root: string, folders: readonly string[]): string[] | undefined {
  const git = gitRunner(root, LIST_BUDGET_MS, FOLDER_PEEK_BYTES);
  if (git === undefined) return undefined;
  const found: string[] = [];
  for (const folder of folders) {
    const listed = git(['ls-files', '-z', '--', `:(icase)${folder}`]);
    // Names before status: a folder git tracks in full prints past the 4 KiB read, which stops git with no status. A
    // git that could not start printed nothing, and its output is undefined, as spawnSync leaves it, so test by truth.
    if (listed.stdout) found.push(folder);
    else if (listed.status !== 0) return undefined;
  }
  return found;
}
