import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readRegularFile } from '../project.js';

/** The most text guard-secrets scans, and the largest file whose lines it reads (ADR-0015). */
export const MAX_CHECKED_SIZE = 1_000_000;

/**
 * The file a write targets: `file`, resolved against the session's working folder, and `real`, its path with
 * every symlink resolved, or null when it does not exist yet. `cause` says why it cannot be found.
 */
export type Location =
  { readonly file: string; readonly real: string | null } | { readonly file: string; readonly cause: string };

/** A target's text ('' when it does not exist yet), or why it cannot be read. */
export type TargetText = { readonly text: string } | { readonly cause: string };

/** Finds the file a write targets, never deciding whether it is inside the project. */
export function locate(target: unknown, baseDir: string): Location {
  if (typeof target !== 'string' || target === '') return { file: '', cause: 'the call names no file' };
  const file = path.resolve(baseDir, target);
  try {
    const exists = lstatSync(file, { throwIfNoEntry: false }) !== undefined;
    return { file, real: exists ? realpathSync.native(file) : null };
  } catch {
    return { file, cause: 'its path could not be resolved' };
  }
}

/**
 * Reads the target through its real path, wherever that is, through one descriptor that follows no symlink and
 * never waits on a FIFO. Whether a path is inside the project is not decided here: case-insensitive file systems,
 * firmlinks and hardlinks make a path-prefix check unreliable, and an edit judged as outside would skip the replay.
 */
export function readTarget(location: Location): TargetText {
  if ('cause' in location) return location;
  if (location.real === null) return { text: '' };
  try {
    const stats = lstatSync(location.real);
    if (!stats.isFile()) return { cause: 'it is not a regular file' };
    if (stats.size > MAX_CHECKED_SIZE) return { cause: 'it is over 1 MB' };
    const text = readRegularFile(location.real, MAX_CHECKED_SIZE);
    return text === null ? { cause: 'it changed while being read' } : { text };
  } catch {
    return { cause: 'it could not be read' };
  }
}
