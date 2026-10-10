import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { PathSafetyError } from '../core/errors.js';
import { lstatOrUndefined, NO_FOLLOW } from './project-files.js';

const EXCLUSIVE_WRITE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;
const RETRIED = new Set(['EPERM', 'EBUSY']);
const BACKOFF_MS = [10, 20, 40, 80, 160, 320];

/** The rename {@link renameWithRetry} calls, injectable so a test can raise EPERM or EBUSY on chosen attempts. */
export type Rename = (from: string, to: string) => void;

function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Renames `from` over `to`, retrying with backoff on EPERM and EBUSY, which Windows raises while an antivirus or
 * an editor briefly holds the target (#24). Any other error, or the last retry's, is thrown.
 */
export function renameWithRetry(from: string, to: string, rename: Rename = renameSync): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const delay = BACKOFF_MS[attempt];
      if (delay === undefined || !RETRIED.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      pause(delay);
    }
  }
}

/**
 * Writes a file through a temp sibling with a random name, opened exclusively (`wx`) and without following a
 * symlink, then flushed and renamed into place, so the target is never half written or written through a link.
 * A given `mode` is set exactly, as when restoring a file; otherwise a new file gets the default mode.
 */
export function writeAtomically(absolute: string, data: Buffer | string, mode?: number): void {
  const temp = path.join(
    path.dirname(absolute),
    `.${path.basename(absolute)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const descriptor = openSync(temp, EXCLUSIVE_WRITE, mode ?? 0o666);
  try {
    try {
      writeFileSync(descriptor, data);
      if (mode !== undefined) fchmodSync(descriptor, mode);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameWithRetry(temp, absolute);
  } catch (error) {
    // A failed write, such as ENOSPC, must not leave a copy of the content, which can hold a token, in the project.
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Deletes a regular file; anything else, such as a symlink, throws PathSafetyError, so no delete follows a link. */
export function removeFile(absolute: string): void {
  const stats = lstatOrUndefined(absolute);
  if (stats === undefined) return;
  if (!stats.isFile()) {
    throw new PathSafetyError({
      file: absolute,
      location: '',
      problem: 'is not a regular file, so the kit does not delete it',
      hint: 'the kit deletes only regular files; if this one should go, remove it yourself and run again',
    });
  }
  unlinkSync(absolute);
}

/** Creates a folder and any missing parents, adding each folder it creates to `created`, outermost first. */
export function ensureFolder(absolute: string, created: string[], mode = 0o777): void {
  const missing: string[] = [];
  for (let folder = absolute; lstatOrUndefined(folder) === undefined; folder = path.dirname(folder)) {
    missing.unshift(folder);
    if (path.dirname(folder) === folder) break;
  }
  for (const folder of missing) {
    mkdirSync(folder, { mode });
    created.push(folder);
  }
}

/** Removes folders an apply created, innermost first, leaving any that something else has since filled. */
export function removeFolders(created: readonly string[]): string[] {
  const left: string[] = [];
  for (const folder of [...created].reverse()) {
    try {
      rmdirSync(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') left.push(folder);
    }
  }
  return left;
}
