import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { isInside, realOrUndefined } from './project.js';

/** An npm `.cmd` or `.bat` shim, which needs a shell on Windows (ADR-0015). */
export const SHIM = /\.(?:cmd|bat)$/i;

/**
 * What a program printed and how it ended: `status` is its exit code, even when it exited before its deadline ended the
 * wait, 128 plus the signal's number when a signal ended it on its own, and null when it could not start, was killed
 * at its deadline, or printed past `maxBuffer`, which cuts its output. A program that could not start leaves `stdout`
 * and `stderr` undefined at run time, as spawnSync does, so read them only after `status`, or by truth.
 */
export interface ToolRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Where and how long a program runs, and how much it may print; a field left undefined takes its default. */
export interface ToolOptions {
  readonly cwd: string;
  /** How long it may run, in milliseconds: 10,000 by default, a literal since each hook bundle counts its bytes. */
  readonly timeoutMs?: number | undefined;
  /** Its environment; by default this process's with colour off (`FORCE_COLOR=0`, `NO_COLOR=1`), as a hook reads it. */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** The most bytes stdout or stderr may hold; past it the program is stopped and its status is null. 1 MiB by default. */
  readonly maxBuffer?: number | undefined;
}

function isProgram(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Runs a program by its absolute path with an argument array, never through a shell, and never an npm `.cmd` or
 * `.bat` shim, which needs one on Windows (ADR-0015). At its deadline the program is killed with SIGKILL, so one that
 * ignores SIGTERM cannot keep the hook past it, though it gets no chance to clean up. Throws for a relative path or a
 * shim.
 */
export function runProgram(file: string, args: readonly string[], options: ToolOptions): ToolRun {
  if (!path.isAbsolute(file) || SHIM.test(file)) {
    throw new Error(`${path.basename(file)} is not an absolute path to a real program`);
  }
  const run = spawnSync(file, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 10_000,
    killSignal: 'SIGKILL',
    windowsHide: true,
    env: options.env ?? { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: options.maxBuffer ?? 1_048_576,
  });
  // spawnSync waits for the output pipes to close, so a process the program left holding them, such as a server a test
  // started, makes it wait out the deadline after the program exited; that exit status still counts. A signal with no
  // error ended the program on its own, such as a crash's SIGSEGV, so it exits as a shell reports it, 128 plus the
  // signal's number, while the deadline's kill, a failed start and output past maxBuffer leave null.
  const cut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS';
  return {
    status: cut ? null : !run.error && run.signal ? 128 + osConstants.signals[run.signal] : run.status,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

/** Runs a Node.js tool's JS entry file with the Node.js that runs this hook, never with npx (ADR-0015). */
export function runNodeTool(entry: string, args: readonly string[], options: ToolOptions): ToolRun {
  return runProgram(process.execPath, [entry, ...args], options);
}

/** The absolute folders of a PATH value, quotes taken off; an empty or relative entry is left out. */
export function absoluteFolders(pathValue: string): string[] {
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.replace(/^"(.*)"$/, '$1'))
    .filter((entry) => path.isAbsolute(entry));
}

/**
 * Finds a program such as git in the absolute PATH folders outside the project: Windows looks in the working
 * folder first and an empty or relative PATH entry means it on POSIX, so a program the project ships would run
 * instead. On Windows only a real `.exe` counts. Undefined when there is none.
 */
export function findProgram(
  name: string,
  projectDir: string,
  pathValue = process.env.PATH ?? '',
): string | undefined {
  const rootReal = realOrUndefined(projectDir) ?? projectDir;
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  return absoluteFolders(pathValue)
    .map((folder) => path.join(folder, file))
    .find((candidate) => {
      const real = realOrUndefined(candidate);
      return real !== undefined && !isInside(rootReal, real) && isProgram(candidate);
    });
}
