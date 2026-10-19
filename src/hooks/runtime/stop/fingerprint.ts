import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { projectStatus } from '../git-status.js';
import { readProjectFile } from '../project.js';
import { isWorkFile } from '../work-files.js';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// A work file's content hash, or, for what cannot be read whole, such as a folder git lists as untracked, a file over
// 1 MB or a symlink, its size and modification time.
function contentOf(projectDir: string, file: string): string {
  const read = readProjectFile(projectDir, file, 1_000_000);
  if ('text' in read) return sha256(read.text);
  try {
    const stats = lstatSync(path.join(projectDir, file));
    return `${String(stats.size)} ${String(stats.mtimeMs)}`;
  } catch {
    return 'missing';
  }
}

/**
 * The change set a stop check runs on (#38): sha256 of HEAD, the command, and each work file that differs from HEAD,
 * untracked ones included, in path order with its content's hash. Undefined when no work file differs, or when git
 * cannot say: no git, no repository, or a repository whose own config sets a filter program or a promisor remote.
 */
export function changeFingerprint(projectDir: string, command: readonly string[]): string | undefined {
  const status = projectStatus(projectDir, true);
  const files = (status?.entries ?? []).map((entry) => entry.path).filter(isWorkFile);
  if (files.length === 0) return undefined;
  // The default sort orders by UTF-16 code units, the same on every OS and locale, as compareText does.
  const parts = files.sort().map((file) => `${file}\0${contentOf(projectDir, file)}`);
  return sha256(`${status?.head ?? ''}\0${JSON.stringify(command)}\0${parts.join('\0')}`);
}
