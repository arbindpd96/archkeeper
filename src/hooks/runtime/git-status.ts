import { gitRunner, unsafeForStatus } from './git.js';

// One deadline for every git call of a status read, so a hook ends well inside its 10-second timeout even when git
// hangs, and lets the action go on by itself instead of being killed.
const GIT_BUDGET_MS = 3000;
// The space-separated fields before the path in each porcelain v2 record kind; a path may hold spaces.
const FIELDS_BEFORE_PATH: Readonly<Record<string, number>> = { '1': 8, '2': 9, u: 10, '?': 1, '!': 1 };

/** One path `git status` lists, relative to the project, with the two-letter code `git status --short` shows. */
export interface StatusEntry {
  readonly code: string;
  readonly path: string;
  /** The path a renamed or copied file came from. */
  readonly from?: string;
}

/** What `git status` says about the project folder. */
export interface ProjectStatus {
  /** The current branch, or undefined on a detached HEAD. */
  readonly branch: string | undefined;
  /** The commit HEAD names, or undefined before the first commit. */
  readonly head: string | undefined;
  readonly entries: readonly StatusEntry[];
}

function headerValue(records: readonly string[], header: string): string | undefined {
  return records.find((record) => record.startsWith(header))?.slice(header.length);
}

function pathAfter(record: string, fields: number): string | undefined {
  const words = record.split(' ');
  return words.length > fields ? words.slice(fields).join(' ') : undefined;
}

function shortCode(record: string): string {
  const kind = record.slice(0, 1);
  return kind === '?' || kind === '!' ? `${kind}${kind}` : record.slice(2, 4).replaceAll('.', ' ');
}

// Porcelain paths start at the repository's root; the project may be a folder inside it.
function entryOf(record: string, from: string | undefined, prefix: string): StatusEntry | undefined {
  const fields = FIELDS_BEFORE_PATH[record.slice(0, 1)];
  const file = fields === undefined || record.slice(1, 2) !== ' ' ? undefined : pathAfter(record, fields);
  if (file === undefined) return undefined;
  const inProject = (name: string): string => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
  const entry = { code: shortCode(record), path: inProject(file) };
  return from === undefined ? entry : { ...entry, from: inProject(from) };
}

function entriesOf(records: readonly string[], prefix: string): StatusEntry[] {
  const entries: StatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    const from = record.startsWith('2 ') ? records[index + 1] : undefined;
    if (from !== undefined) index += 1;
    const entry = entryOf(record, from, prefix);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

/** Reads `git status --porcelain=v2 -z --branch` output, with paths made relative to the project by `prefix`. */
export function parseStatus(stdout: string, prefix: string): ProjectStatus {
  const records = stdout.split('\0');
  const branch = headerValue(records, '# branch.head ');
  const head = headerValue(records, '# branch.oid ');
  return {
    branch: branch === '(detached)' ? undefined : branch,
    head: head === '(initial)' ? undefined : head,
    entries: entriesOf(records, prefix),
  };
}

/**
 * `git status` of the project folder alone, untracked files included only when asked, through the hardened
 * runner. Undefined when git is missing, the folder is in no repository, git fails or its calls take over 3 seconds
 * in all, or the repository's own config sets a filter program or a promisor remote, which status would run or fetch
 * from.
 */
export function projectStatus(projectDir: string, untracked: boolean): ProjectStatus | undefined {
  const git = gitRunner(projectDir, GIT_BUDGET_MS);
  const prefix = git?.(['rev-parse', '--show-prefix']);
  if (git === undefined || prefix?.status !== 0 || unsafeForStatus(git) !== false) return undefined;
  const files = untracked ? 'normal' : 'no';
  const status = git(
    `status --porcelain=v2 -z --branch --ignore-submodules=all --untracked-files=${files} -- .`.split(' '),
  );
  return status.status === 0 ? parseStatus(status.stdout, prefix.stdout.replace(/\r?\n$/, '')) : undefined;
}
