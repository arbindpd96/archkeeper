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
import { PathSafetyError } from '../core/errors.js';
import { exactHash } from '../core/hash.js';
import type { PathState } from '../core/plan-types.js';
import { compareText, toLf } from '../core/text.js';
import { ensureFolder, writeAtomically } from './atomic-files.js';
import { baseFolder, compressed } from './blob-store.js';
import { confinedPath, lstatOrUndefined, NO_FOLLOW, readConfined } from './project-files.js';

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
const STATE_SOURCE = 'the kit state folder';

/** The project folder that holds every backup run. */
export function backupsFolder(brand: Brand): string {
  return `${brand.stateDir}/local/backup`;
}

function stateRefused(relative: string, problem: string, hint: string): PathSafetyError {
  return new PathSafetyError({ file: JSON.stringify(relative), location: STATE_SOURCE, problem, hint });
}

function stateFolders(brand: Brand): string[] {
  const folders = [backupsFolder(brand), baseFolder(brand)];
  const prefixes = folders.flatMap((folder) =>
    folder.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')),
  );
  return [...new Set(prefixes)];
}

/**
 * Refuses a kit state folder (`<state dir>`, `local/`, `local/backup/` or `base/`) that is a symlink, a junction
 * or not a folder, before the kit reads or writes there: a link would put backups, which can hold copies of
 * ignored files with tokens, where neither ignore covers them, and let pruning delete files through it.
 */
export function assertRealStateFolders(rootReal: string, brand: Brand): void {
  for (const relative of stateFolders(brand)) {
    const stats = lstatOrUndefined(confinedPath(rootReal, relative, STATE_SOURCE));
    if (stats === undefined || (stats.isDirectory() && !stats.isSymbolicLink())) continue;
    const what = stats.isSymbolicLink() ? 'a symlink' : 'not a folder';
    throw stateRefused(
      relative,
      `is refused: it is ${what}, and the kit keeps its state, backups included, only in real folders`,
      'replace it with a real folder, or remove it so the kit creates one, and run again',
    );
  }
}

function isIgnoreAll(state: PathState | undefined): boolean {
  return state?.kind === 'file' && toLf(state.content).trim() === '*';
}

/**
 * Creates `<state dir>/local/` when it is missing, with its own `.gitignore` of `*`, which ignores the folder
 * and itself, so backups and hook state are never committed even if the user deletes the root ignore block. An
 * ignore file there that holds anything else is rewritten; one that is not a regular file is refused.
 */
export function ensureLocalFolder(rootReal: string, brand: Brand): void {
  const local = confinedPath(rootReal, `${brand.stateDir}/local`, STATE_SOURCE);
  ensureFolder(path.dirname(local), []);
  ensureFolder(local, [], PRIVATE_FOLDER);
  const relative = `${brand.stateDir}/local/.gitignore`;
  const ignore = confinedPath(rootReal, relative, STATE_SOURCE);
  const stats = lstatOrUndefined(ignore);
  if (stats !== undefined && !stats.isFile()) {
    const hint = 'remove it so the kit writes its own, and run again';
    throw stateRefused(
      relative,
      'is refused: it is not a regular file, so it may not ignore the backups',
      hint,
    );
  }
  if (!isIgnoreAll(stats === undefined ? undefined : readConfined(rootReal, relative, STATE_SOURCE))) {
    writeAtomically(ignore, '*\n');
  }
}

function runId(): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
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

function held(absolute: string): Saved {
  const stats = lstatOrUndefined(absolute);
  if (stats === undefined) return { type: 'absent' };
  if (stats.isSymbolicLink()) return { type: 'symlink', target: readlinkSync(absolute) };
  if (!stats.isFile()) return { type: 'other' };
  const bytes = readExactly(absolute);
  return { type: 'file', blob: exactHash(bytes), mode: stats.mode & 0o777, bytes };
}

/** What each path an apply will touch holds now, read without following a symlink and without writing anything. */
export function currentPaths(targets: readonly { relative: string; absolute: string }[]): SavedPath[] {
  return targets.map((target) => ({ ...target, saved: held(target.absolute) }));
}

function writeBlob(folder: string, saved: Saved): void {
  if (saved.type !== 'file') return;
  try {
    writeFileSync(path.join(folder, saved.blob), compressed(saved.bytes), { flag: 'wx', mode: PRIVATE_FILE });
  } catch (error) {
    // Two paths with the same bytes share one content-addressed blob.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
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
 * Backs up every path an apply will touch, as {@link currentPaths} read them (#24): each file as a compressed
 * blob named by the sha256 of its bytes, plus a `manifest.json` that records whether each path was a file, a
 * symlink (with its target) or absent. Backups can hold copies of gitignored files, so each file is mode 0600.
 */
export function backUp(rootReal: string, paths: readonly SavedPath[], brand: Brand): Backup {
  ensureLocalFolder(rootReal, brand);
  const relative = `${backupsFolder(brand)}/${runId()}`;
  const folder = confinedPath(rootReal, relative, 'the kit backup folder');
  ensureFolder(folder, [], PRIVATE_FOLDER);
  for (const { saved } of paths) writeBlob(folder, saved);
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
