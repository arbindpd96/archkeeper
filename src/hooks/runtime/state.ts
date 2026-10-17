import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { BRAND, type Brand } from '../../core/brand.js';
import { isInside, NO_FOLLOW, readRegularFile } from './project.js';

const PRIVATE_FOLDER = 0o700;
const PRIVATE_FILE = 0o600;
const IGNORE_ALL = '*\n';
const IGNORE_FILE = '.gitignore';
const MAX_STATE_BYTES = 1_000_000;
const STATE_NAME = /^(?!\.{1,2}(?:\/|$))[\w.-]+(?:\/(?!\.{1,2}(?:\/|$))[\w.-]+)*$/;
// Created exclusively, so a file or link planted at the temp name is never written through.
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;

/** A hook state write that was refused, never redirected (ADR-0015); the hook reports the problem. */
export class StateRefused extends Error {
  override name = 'StateRefused';
}

/** The outcome of a state write: written, or skipped with the reason the hook reports on stderr. */
export type StateWrite = { readonly written: true } | { readonly written: false; readonly problem: string };

interface StateFile {
  readonly file: string;
  readonly rootReal: string;
}

function refused(folder: string, problem: string): never {
  throw new StateRefused(`${folder} ${problem}`);
}

// Every folder on the way must be a real folder whose real path is inside the project; a missing one is created
// only for a write, so a read changes nothing on disk.
function ensureRealFolder(folder: string, rootReal: string, create: boolean): void {
  const stats = lstatSync(folder, { throwIfNoEntry: false });
  if (stats === undefined) {
    if (!create) refused(folder, 'does not exist');
    mkdirSync(folder, { mode: PRIVATE_FOLDER });
    return;
  }
  if (stats.isSymbolicLink()) refused(folder, 'is a symlink');
  if (!stats.isDirectory()) refused(folder, 'is not a folder');
  if (!isInside(rootReal, realpathSync.native(folder))) refused(folder, 'resolves outside the project');
}

// O_NOFOLLOW guards only the last name, so a folder swapped for a link after its check is caught here instead.
function writeExclusively(file: string, content: string, rootReal: string): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const descriptor = openSync(temp, CREATE_FLAGS, PRIVATE_FILE);
  try {
    if (!isInside(rootReal, realpathSync.native(path.dirname(temp)))) {
      refused(path.dirname(file), 'moved outside the project');
    }
    writeSync(descriptor, content);
  } catch (error) {
    closeSync(descriptor);
    rmSync(temp, { force: true });
    throw error;
  }
  closeSync(descriptor);
  try {
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

// Whatever creates local/ writes its .gitignore of `*`, which ignores the folder and itself (ADR-0014).
function ensureIgnoreAll(local: string, rootReal: string): void {
  const ignore = path.join(local, IGNORE_FILE);
  const stats = lstatSync(ignore, { throwIfNoEntry: false });
  if (stats !== undefined && !stats.isFile()) refused(ignore, 'is not a regular file');
  const text = stats === undefined ? null : readRegularFile(ignore, MAX_STATE_BYTES);
  if (text?.replaceAll('\r', '').trim() !== '*') writeExclusively(ignore, IGNORE_ALL, rootReal);
}

/** `<state dir>/local/`, checked to be a real folder inside the project, and created with its `.gitignore` if asked. */
function localFolder(projectDir: string, brand: Brand, create: boolean): { local: string; rootReal: string } {
  const rootReal = realpathSync.native(projectDir);
  const local = path.join(projectDir, brand.stateDir, 'local');
  ensureRealFolder(path.dirname(local), rootReal, create);
  ensureRealFolder(local, rootReal, create);
  if (create) ensureIgnoreAll(local, rootReal);
  return { local, rootReal };
}

/** Where `<state dir>/local/<name>` is, with every folder on the way checked, and created when `create` is set. */
function stateFile(projectDir: string, name: string, brand: Brand, create: boolean): StateFile {
  if (!STATE_NAME.test(name) || name === IGNORE_FILE) {
    throw new StateRefused(`${name} is not a plain relative state name`);
  }
  const { local, rootReal } = localFolder(projectDir, brand, create);
  const parts = name.split('/');
  let folder = local;
  for (const part of parts.slice(0, -1)) {
    folder = path.join(folder, part);
    ensureRealFolder(folder, rootReal, create);
  }
  const file = path.join(folder, parts.at(-1) ?? '');
  const stats = lstatSync(file, { throwIfNoEntry: false });
  if (stats !== undefined && !stats.isFile()) refused(file, 'is not a regular file');
  return { file, rootReal };
}

/**
 * Writes hook state to `<state dir>/local/<name>` with mode 0600 through a temp file created without following
 * symlinks, then renamed into place, so neither a symlink nor a hardlink planted at the name is written through.
 * A refused write is skipped and its reason returned for the hook to report (ADR-0015).
 */
export function writeState(
  projectDir: string,
  name: string,
  content: string,
  brand: Brand = BRAND,
): StateWrite {
  try {
    const { file, rootReal } = stateFile(projectDir, name, brand, true);
    writeExclusively(file, content, rootReal);
    return { written: true };
  } catch (error) {
    return { written: false, problem: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Creates `<state dir>/local/` with its `.gitignore` of `*` where either is missing, as a state write does, so a
 * file a skill later writes there, such as the active-feature pointer, is ignored from the start (ADR-0014). A
 * refused folder is left alone and its reason returned for the hook to report.
 */
export function prepareLocalState(projectDir: string, brand: Brand = BRAND): StateWrite {
  try {
    localFolder(projectDir, brand, true);
    return { written: true };
  } catch (error) {
    return { written: false, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads hook state from `<state dir>/local/<name>`, or null when it is missing, refused or not a small regular file. */
export function readState(projectDir: string, name: string, brand: Brand = BRAND): string | null {
  try {
    return readRegularFile(stateFile(projectDir, name, brand, false).file, MAX_STATE_BYTES);
  } catch {
    return null;
  }
}
