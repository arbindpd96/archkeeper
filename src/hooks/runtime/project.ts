import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';

// Windows has neither flag, so callers there `lstat` a path before they open it.
const optional: Partial<typeof constants> = constants;
/** Opens a path without following a symlink where the platform supports it. */
export const NO_FOLLOW = optional.O_NOFOLLOW ?? 0;
const NON_BLOCKING = optional.O_NONBLOCK ?? 0;
/** Opens a path for reading without following a symlink or waiting on a FIFO, where the platform supports it. */
export const SAFE_READ = constants.O_RDONLY | NO_FOLLOW | NON_BLOCKING;

/**
 * The project folder a hook works in: `CLAUDE_PROJECT_DIR`, or the working folder when it is unset or empty. Both
 * guards and the runtime take it from here, so they never disagree about where the project is.
 */
export function projectDirOf(env: NodeJS.ProcessEnv, cwd: string): string {
  const named = env.CLAUDE_PROJECT_DIR;
  return named === undefined || named === '' ? cwd : named;
}

/** A path with forward slashes, the form hooks report paths in on every OS (ADR-0015). */
export function slashed(file: string): string {
  return file.replaceAll('\\', '/');
}

/** The real path of a file or folder, or undefined when it does not exist or cannot be resolved. */
export function realOrUndefined(file: string): string | undefined {
  try {
    return realpathSync.native(file);
  } catch {
    return undefined;
  }
}

/** Tells whether `real` is `root` or lies under it; both are real paths. */
export function isInside(root: string, real: string): boolean {
  const relative = path.relative(root, real);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

// Reads one byte past the cap, so a file that grew after its fstat is refused instead of read to its end.
function readCapped(descriptor: number, maxBytes: number): string | null {
  const buffer = Buffer.alloc(maxBytes + 1);
  let length = 0;
  let read: number;
  do {
    read = readSync(descriptor, buffer, length, buffer.length - length, null);
    length += read;
  } while (read > 0 && length < buffer.length);
  return length > maxBytes ? null : buffer.toString('utf8', 0, length);
}

/**
 * Reads a regular file of at most `maxBytes` through one descriptor that follows no symlink and never waits on a
 * FIFO; null for anything else, or for a file that grew past the cap. Throws when the path cannot be opened.
 */
export function readRegularFile(file: string, maxBytes: number): string | null {
  const descriptor = openSync(file, SAFE_READ);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maxBytes) return null;
    return readCapped(descriptor, maxBytes);
  } finally {
    closeSync(descriptor);
  }
}

/** Why a project file cannot be read, or its text; `missing` when nothing is at the path. */
export type ProjectRead =
  { readonly text: string } | { readonly missing: true } | { readonly problem: string };

/**
 * Reads a file of the project by its project-relative path, only when it is a regular file of at most `maxBytes`
 * whose real path is inside the project and which is no symlink (ADR-0015).
 */
export function readProjectFile(projectDir: string, relative: string, maxBytes: number): ProjectRead {
  const file = path.join(projectDir, ...relative.split('/'));
  try {
    const stats = lstatSync(file, { throwIfNoEntry: false });
    if (stats === undefined) return { missing: true };
    if (stats.isSymbolicLink()) return { problem: 'it is a symlink' };
    if (!isInside(realpathSync.native(projectDir), realpathSync.native(file))) {
      return { problem: 'it resolves outside the project' };
    }
    const text = readRegularFile(file, maxBytes);
    return text === null ? { problem: 'it is not a regular file of a readable size' } : { text };
  } catch {
    return { problem: 'it could not be read' };
  }
}
