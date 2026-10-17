import path from 'node:path';
import { isInside, realOrUndefined } from './project.js';
import { findProgram, runProgram, type ToolRun } from './tools.js';

/** Runs git with an argument array in one project folder, hardened as {@link gitRunner} describes. */
export type Git = (args: readonly string[]) => ToolRun;

// No fsmonitor, so a repository's config cannot start its fsmonitor hook; no optional locks, so git writes nothing.
const SAFE = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];
const STATUS_HAZARDS = String.raw`^(filter\..*\.(clean|process)|extensions\.partialclone|remote\..*\.promisor)$`;
const CALLER_VARIABLES = /^(?:GIT_(?!CEILING_DIRECTORIES$)|PATH$)/i;

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

// A git hook or `rebase --exec` exports GIT_DIR and friends, which point git at another repository; only the ceiling,
// which just stops git looking further up, stays. No lazy fetch (git 2.44+), and English messages in every locale.
function gitEnv(folders: readonly string[]): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !CALLER_VARIABLES.test(name));
  const own = { PATH: folders.join(path.delimiter), LC_ALL: 'C', GIT_NO_LAZY_FETCH: '1' };
  return { ...Object.fromEntries(kept), ...own };
}

/**
 * git for one project folder, with no shell and no network (ADR-0015, ADR-0018): found only in absolute PATH
 * folders outside the project, which are also the only PATH it gets, with no `GIT_*` variable from a caller but the
 * ceiling, no fsmonitor, no optional locks and no lazy fetch. Undefined when no such folder holds git.
 */
export function gitRunner(root: string, timeoutMs?: number): Git | undefined {
  const rootReal = realOrUndefined(root) ?? root;
  const folders = trustedPath(rootReal);
  const git = findProgram('git', rootReal, folders.join(path.delimiter));
  if (git === undefined) return undefined;
  const env = gitEnv(folders);
  const limit = timeoutMs === undefined ? {} : { timeoutMs };
  return (args) => runProgram(git, [...SAFE, ...args], { cwd: root, env, ...limit });
}

/**
 * Whether the repository's own config sets something `git status` would run or fetch from: a filter program, run on
 * a changed file, or a partial clone's promisor remote, which git before 2.44 fetches missing objects from despite
 * GIT_NO_LAZY_FETCH (git matches the names in lowercase). A repository that arrives with its .git folder (a zip) can
 * set either in its own or a submodule's config, which status never enters; global and system config are the
 * user's. Undefined when git cannot say.
 */
export function unsafeForStatus(git: Git): boolean | undefined {
  const config = git(['config', '--show-scope', '--get-regexp', STATUS_HAZARDS]);
  if (config.status === 1) return false;
  if (config.status !== 0) return undefined;
  return config.stdout.split('\n').some((line) => /^(?:local|worktree)\t/.test(line));
}
