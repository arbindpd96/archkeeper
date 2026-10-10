import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { isInside, realOrUndefined } from './project.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const SHIM = /\.(?:cmd|bat)$/i;

/** What a program printed and how it ended; `status` is null when it could not start or was killed. */
export interface ToolRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Where and how long a program runs. */
export interface ToolOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
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
 * `.bat` shim, which needs one on Windows (ADR-0015). Throws for a relative path or a shim.
 */
export function runProgram(file: string, args: readonly string[], options: ToolOptions): ToolRun {
  if (!path.isAbsolute(file) || SHIM.test(file)) {
    throw new Error(`${path.basename(file)} is not an absolute path to a real program`);
  }
  const run = spawnSync(file, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    windowsHide: true,
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const status = run.error === undefined ? run.status : null;
  return { status, stdout: run.stdout, stderr: run.stderr };
}

/** Runs a Node.js tool's JS entry file with the Node.js that runs this hook, never with npx (ADR-0015). */
export function runNodeTool(entry: string, args: readonly string[], options: ToolOptions): ToolRun {
  return runProgram(process.execPath, [entry, ...args], options);
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
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.replace(/^"(.*)"$/, '$1'))
    .filter((entry) => path.isAbsolute(entry))
    .map((folder) => path.join(folder, file))
    .find((candidate) => {
      const real = realOrUndefined(candidate);
      return real !== undefined && !isInside(rootReal, real) && isProgram(candidate);
    });
}
