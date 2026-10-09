import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  openSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { Brand } from '../core/brand.js';
import { compareText } from '../core/text.js';
import { ensureFolder, writeAtomically } from './atomic-files.js';
import { bytesHash, compressed } from './blob-store.js';
import { confinedPath, lstatOrUndefined, NO_FOLLOW } from './project-files.js';

/** What a path held before an apply touched it: a file with its bytes and mode, a symlink, or nothing. */
export type Saved =
  | { readonly type: 'file'; readonly blob: string; readonly mode: number; readonly bytes: Buffer }
  | { readonly type: 'symlink'; readonly target: string }
  | { readonly type: 'absent' }
  | { readonly type: 'other' };

/** One backed-up path. */
export interface SavedPath {
  readonly relative: string;
  readonly absolute: string;
  readonly saved: Saved;
}

/** A backup run under `<state dir>/local/backup/<runId>/`. */
export interface Backup {
  readonly folder: string;
  readonly paths: readonly SavedPath[];
}

const PRIVATE_FILE = 0o600;
const PRIVATE_FOLDER = 0o700;

/** The project folder that holds every backup run. */
export function backupsFolder(brand: Brand): string {
  return `${brand.stateDir}/local/backup`;
}

/**
 * Creates `<state dir>/local/` when it is missing, with its own `.gitignore` of `*`, which ignores the folder
 * and itself, so backups and hook state are never committed even if the user deletes the root ignore block.
 */
export function ensureLocalFolder(rootReal: string, brand: Brand): void {
  const local = confinedPath(rootReal, `${brand.stateDir}/local`, 'the kit state folder');
  ensureFolder(path.dirname(local), []);
  ensureFolder(local, [], PRIVATE_FOLDER);
  const ignore = confinedPath(rootReal, `${brand.stateDir}/local/.gitignore`, 'the kit state folder');
  if (lstatOrUndefined(ignore) === undefined) writeAtomically(ignore, '*\n');
}

function runId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return `${stamp}-${randomBytes(4).toString('hex')}`;
}

function readExactly(absolute: string): Buffer {
  const descriptor = openSync(absolute, constants.O_RDONLY | NO_FOLLOW);
  try {
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function save(absolute: string, folder: string): Saved {
  const stats = lstatOrUndefined(absolute);
  if (stats === undefined) return { type: 'absent' };
  if (stats.isSymbolicLink()) return { type: 'symlink', target: readlinkSync(absolute) };
  if (!stats.isFile()) return { type: 'other' };
  const bytes = readExactly(absolute);
  const blob = bytesHash(bytes);
  try {
    writeFileSync(path.join(folder, blob), compressed(bytes), { flag: 'wx', mode: PRIVATE_FILE });
  } catch (error) {
    // Two paths with the same bytes share one content-addressed blob.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return { type: 'file', blob, mode: stats.mode & 0o777, bytes };
}

function manifest(paths: readonly SavedPath[]): string {
  const entries = [...paths]
    .sort((left, right) => compareText(left.relative, right.relative))
    .map(({ relative, saved }): [string, unknown] => {
      if (saved.type === 'file') return [relative, { type: 'file', blob: saved.blob, mode: saved.mode }];
      return [relative, saved];
    });
  return `${JSON.stringify({ paths: Object.fromEntries(entries) }, null, 2)}\n`;
}

/**
 * Backs up every path an apply will touch (#24): each file as a compressed blob named by the sha256 of its
 * bytes, plus a `manifest.json` that records whether each path was a file, a symlink (with its target) or
 * absent. Backups can hold copies of gitignored files, so every file in them is created with mode 0600.
 */
export function backUp(
  rootReal: string,
  targets: readonly { relative: string; absolute: string }[],
  brand: Brand,
): Backup {
  ensureLocalFolder(rootReal, brand);
  const relative = `${backupsFolder(brand)}/${runId()}`;
  const folder = confinedPath(rootReal, relative, 'the kit backup folder');
  ensureFolder(folder, [], PRIVATE_FOLDER);
  const paths = targets.map((target) => ({ ...target, saved: save(target.absolute, folder) }));
  writeFileSync(path.join(folder, 'manifest.json'), manifest(paths), { flag: 'wx', mode: PRIVATE_FILE });
  return { folder: relative, paths };
}

/** Puts a path back as the backup recorded it: the same bytes and mode, the same symlink, or nothing. */
export function restore({ absolute, saved }: SavedPath): void {
  if (saved.type === 'other') return;
  if (saved.type === 'file') {
    ensureFolder(path.dirname(absolute), []);
    writeAtomically(absolute, saved.bytes, saved.mode);
    return;
  }
  const current = lstatOrUndefined(absolute);
  if (current !== undefined && !current.isDirectory()) unlinkSync(absolute);
  if (saved.type === 'symlink') symlinkSync(saved.target, absolute);
}
