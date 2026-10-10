import { readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BRAND, type Brand } from '../core/brand.js';
import { ApplyError, ArchkeeperError, PathSafetyError } from '../core/errors.js';
import { HASH } from '../core/hash.js';
import { type Lock, lockFilePath } from '../core/lock.js';
import type { Plan } from '../core/plan.js';
import { toLf } from '../core/text.js';
import { ensureFolder, removeFile, removeFolders, writeAtomically } from './atomic-files.js';
import { backUp, type Backup, backupsFolder, restore, type SavedPath } from './backup.js';
import { baseFolder, compressed } from './blob-store.js';
import { confinedPath, lstatOrUndefined, readState } from './project-files.js';

/** What an apply did: whether it wrote anything, where its backup is, and cleanup problems worth reporting. */
export interface ApplyResult {
  readonly changed: boolean;
  /** The project-relative backup folder of this run, when it wrote anything. */
  readonly backup?: string;
  readonly warnings: readonly string[];
}

interface Change {
  readonly relative: string;
  readonly absolute: string;
  /** The bytes to write, or null to delete the file. */
  readonly data: Buffer | string | null;
}

const KEPT_BACKUPS = 3;
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

// Blobs first and the lock last, so an interrupted run leaves the previous lock and the next run plans again.
function changes(rootReal: string, plan: Plan, brand: Brand): Change[] {
  const confined = (relative: string): string => confinedPath(rootReal, relative, 'written by the plan');
  const blobs = [...plan.blobs].flatMap(([hash, content]) => {
    const relative = `${baseFolder(brand)}/${hash}`;
    const absolute = confined(relative);
    return lstatOrUndefined(absolute) === undefined
      ? [{ relative, absolute, data: compressed(content) }]
      : [];
  });
  const writes = [...plan.writes].map(([relative, data]) => ({
    relative,
    absolute: confined(relative),
    data,
  }));
  const lock = lockFilePath(brand);
  const lockPath = confined(lock);
  const current = readState(lockPath);
  const lockChange =
    current?.kind === 'file' && toLf(current.content) === plan.lockText
      ? []
      : [{ relative: lock, absolute: lockPath, data: plan.lockText }];
  return [...blobs, ...writes, ...lockChange];
}

function refuseUnwritable(backup: Backup): void {
  const blocked = backup.paths.find(({ saved }) => saved.type === 'symlink' || saved.type === 'other');
  if (blocked === undefined) return;
  const what = blocked.saved.type === 'symlink' ? 'a symlink' : 'not a regular file';
  throw new PathSafetyError({
    file: JSON.stringify(blocked.relative),
    location: 'written by the plan',
    problem: `is now ${what}, which the kit never writes through or deletes`,
    hint: 'it changed after the plan was made; run again to plan with what is there now',
  });
}

// A path edited between planning and applying, say while init waits for a yes, would lose that edit.
function refuseChanged(backup: Backup, expected: ReadonlyMap<string, string | null>): void {
  const changed = backup.paths.find(({ relative, saved }) => {
    if (!expected.has(relative)) return false;
    return expected.get(relative) !== (saved.type === 'file' ? saved.blob : null);
  });
  if (changed === undefined) return;
  throw new ApplyError({
    file: changed.relative,
    location: '',
    problem: 'changed after the plan was made, so the kit wrote nothing',
    hint: 'run again to plan against the file as it is now',
  });
}

function applyChange(change: Change, saved: SavedPath | undefined, created: string[]): void {
  if (change.data === null) {
    removeFile(change.absolute);
    return;
  }
  ensureFolder(path.dirname(change.absolute), created);
  writeAtomically(change.absolute, change.data, saved?.saved.type === 'file' ? saved.saved.mode : undefined);
}

function rollBack(backup: Backup, created: readonly string[]): string[] {
  const failed: string[] = [];
  for (const saved of [...backup.paths].reverse()) {
    try {
      restore(saved);
    } catch (error) {
      failed.push(`${saved.relative} (${reasonOf(error)})`);
    }
  }
  return [...failed, ...removeFolders(created)];
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Nothing outside the kit's local folder is written until the backup is complete.
function backUpOrFail(rootReal: string, pending: readonly Change[], brand: Brand): Backup {
  try {
    return backUp(rootReal, pending, brand);
  } catch (error) {
    if (error instanceof ArchkeeperError) throw error;
    throw new ApplyError({
      file: backupsFolder(brand),
      location: '',
      problem: `could not hold a backup (${reasonOf(error)}); nothing in the project was changed`,
      hint: 'fix the cause, such as permissions or free disk space, and run again',
    });
  }
}

function failure(
  error: unknown,
  change: Change | undefined,
  backup: Backup,
  unrestored: readonly string[],
): ApplyError {
  const restored =
    unrestored.length === 0
      ? 'every file it touched was restored'
      : `these could not be restored: ${unrestored.join(', ')}`;
  return new ApplyError({
    file: change?.relative ?? backup.folder,
    location: '',
    problem: `could not be changed (${reasonOf(error)}); ${restored}`,
    hint: `fix the cause and run again; the files as they were are in ${backup.folder}`,
  });
}

function referencedBlobs(lock: Lock): Set<string> {
  const entries = [...lock.files.values()].filter((entry) => entry.strategy === 'owned');
  const blocks = [...lock.blocks.values()].flatMap((map) => [...map.values()]);
  return new Set([...entries, ...blocks].flatMap(({ base, pending }) => [base ?? '', pending ?? '']));
}

function folderEntries(absolute: string): string[] {
  return lstatOrUndefined(absolute)?.isDirectory() === true ? readdirSync(absolute) : [];
}

// A blob is removed when no lock entry references it; anything not named like a blob is left alone.
function pruneBlobs(rootReal: string, lock: Lock, brand: Brand): string[] {
  const folder = confinedPath(rootReal, baseFolder(brand), 'the kit base folder');
  const referenced = referencedBlobs(lock);
  return folderEntries(folder)
    .filter((name) => HASH.test(name) && !referenced.has(name))
    .flatMap((name) => {
      try {
        removeFile(path.join(folder, name));
        return [];
      } catch (error) {
        return [
          `${baseFolder(brand)}/${name} is no longer needed but could not be removed: ${String(error)}`,
        ];
      }
    });
}

function pruneBackups(rootReal: string, brand: Brand): string[] {
  const folder = confinedPath(rootReal, backupsFolder(brand), 'the kit backup folder');
  const runs = folderEntries(folder)
    .filter((name) => RUN_ID.test(name))
    .sort();
  return runs.slice(0, Math.max(0, runs.length - KEPT_BACKUPS)).flatMap((name) => {
    const run = path.join(folder, name);
    if (lstatOrUndefined(run)?.isDirectory() !== true) return [];
    try {
      rmSync(run, { recursive: true });
      return [];
    } catch (error) {
      return [`${backupsFolder(brand)}/${name} is an old backup that could not be removed: ${String(error)}`];
    }
  });
}

/**
 * Applies a plan all-or-nothing (#24). Every path it touches is backed up first under
 * `<state dir>/local/backup/<runId>/`; each write goes to a temp sibling renamed into place; any failure restores
 * every path to its earlier content and type and removes the folders the run created; the lock is written last.
 * Base blobs are written only when absent, and unreferenced ones and all but the last 3 backups are removed.
 */
export function applyPlan(root: string, plan: Plan, brand: Brand = BRAND): ApplyResult {
  const rootReal = realpathSync.native(root);
  const pending = changes(rootReal, plan, brand);
  if (pending.length === 0) return { changed: false, warnings: [] };
  const backup = backUpOrFail(rootReal, pending, brand);
  refuseUnwritable(backup);
  refuseChanged(backup, plan.expected);
  const created: string[] = [];
  let current: Change | undefined;
  try {
    for (const [index, change] of pending.entries()) {
      current = change;
      applyChange(change, backup.paths[index], created);
    }
  } catch (error) {
    throw failure(error, current, backup, rollBack(backup, created));
  }
  const warnings = [...pruneBlobs(rootReal, plan.lock, brand), ...pruneBackups(rootReal, brand)];
  return { changed: true, backup: backup.folder, warnings };
}
