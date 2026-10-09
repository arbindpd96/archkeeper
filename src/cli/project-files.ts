import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from 'node:fs';
import path from 'node:path';
import { PathSafetyError } from '../core/errors.js';
import { assertSafePath, pathSafetyProblem } from '../core/path-safety.js';
import type { PathState, Snapshot } from '../core/plan-types.js';

// Windows has neither flag; there the lstat check before opening is what keeps a symlink from being followed.
const optional: Partial<typeof constants> = constants;
/** Opens a path without following a symlink where the platform supports it. */
export const NO_FOLLOW = optional.O_NOFOLLOW ?? 0;
const NON_BLOCKING = optional.O_NONBLOCK ?? 0;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The status of a path without following a symlink, or undefined when nothing is there. */
export function lstatOrUndefined(absolute: string): Stats | undefined {
  try {
    return lstatSync(absolute);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw error;
  }
}

function deepestExisting(absolute: string): string {
  let current = absolute;
  while (lstatOrUndefined(current) === undefined) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function refused(relative: string, source: string, problem: string): PathSafetyError {
  return new PathSafetyError({
    file: JSON.stringify(relative),
    location: source,
    problem: `is refused as a write or delete target: it ${problem}`,
    hint: 'replace the symlink with a real folder inside the project, or remove it, and run again',
  });
}

/**
 * Resolves a project-relative path under the real project root, refusing it when it fails the path-safety checks
 * or when a symlinked folder on its way resolves (via realpath) outside the project or into `.git` (#23).
 */
export function confinedPath(rootReal: string, relative: string, source: string): string {
  assertSafePath(relative, source);
  const target = path.join(rootReal, ...relative.split('/'));
  const existing = deepestExisting(path.dirname(target));
  const real = path.relative(rootReal, realpathSync.native(existing));
  if (real === '..' || real.startsWith(`..${path.sep}`) || path.isAbsolute(real)) {
    throw refused(relative, source, 'resolves through a symlink to a place outside the project');
  }
  const resolved = [...real.split(path.sep), ...path.relative(existing, target).split(path.sep)];
  const problem = pathSafetyProblem(resolved.filter((segment) => segment !== '').join('/'));
  if (problem !== undefined) {
    throw refused(relative, source, `resolves through a symlink to a path that ${problem}`);
  }
  return target;
}

function readText(absolute: string): PathState {
  const descriptor = openSync(absolute, constants.O_RDONLY | NO_FOLLOW | NON_BLOCKING);
  try {
    if (!fstatSync(descriptor).isFile()) return { kind: 'other' };
    return { kind: 'file', content: STRICT_UTF8.decode(readFileSync(descriptor)) };
  } catch (error) {
    // A file that is not UTF-8 text cannot be merged without changing its bytes, so it counts as not a text file.
    const notText = (error as NodeJS.ErrnoException).code === 'ERR_ENCODING_INVALID_ENCODED_DATA';
    if (notText) return { kind: 'other' };
    throw error;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Reads what is at a path without following a symlink: a UTF-8 text file with its content, a symlink, anything
 * else (a folder, a FIFO or a file that is not UTF-8 text), or undefined when nothing is there.
 */
export function readState(absolute: string): PathState | undefined {
  const stats = lstatOrUndefined(absolute);
  if (stats === undefined) return undefined;
  if (stats.isSymbolicLink()) return { kind: 'symlink' };
  return stats.isFile() ? readText(absolute) : { kind: 'other' };
}

/** Reads each project path the plan needs, after confining it to the project (#23). */
export function readSnapshot(rootReal: string, paths: readonly string[]): Snapshot {
  const snapshot = new Map<string, PathState>();
  for (const relative of paths) {
    const state = readState(confinedPath(rootReal, relative, 'read for the plan'));
    if (state !== undefined) snapshot.set(relative, state);
  }
  return snapshot;
}
