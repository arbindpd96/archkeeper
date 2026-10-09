import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';
import { BRAND } from '../src/core/brand.js';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const SCRIPT_TIMEOUT_MS = 15_000;
const ISOLATED_GIT_ENV = {
  GIT_CONFIG_GLOBAL: path.join(tmpdir(), `${BRAND.npmName}-empty-gitconfig`),
  GIT_CONFIG_NOSYSTEM: '1',
};
const TEST_GIT_CONFIG = [
  '-c',
  'user.name=test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false',
];

/** Result of running a script the way Claude Code or a developer would. */
export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a Node script from the repo with an optional JSON payload on stdin. */
export function runScript(
  script: string,
  options: { payload?: unknown; args?: string[]; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, script), ...(options.args ?? [])], {
    input: options.payload === undefined ? '' : JSON.stringify(options.payload),
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    timeout: SCRIPT_TIMEOUT_MS,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Creates an empty temporary directory that is deleted when the current test finishes. */
export function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), `${BRAND.npmName}-test-`));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** Creates a throwaway git repository whose first commit contains the given files. */
export function tempRepo(files: Record<string, string> = {}): string {
  const dir = tempDir();
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      timeout: SCRIPT_TIMEOUT_MS,
      env: { ...process.env, ...ISOLATED_GIT_ENV },
    });
  writeFiles(dir, files);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git(...TEST_GIT_CONFIG, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

/** Writes files (creating parent folders) relative to `dir`. */
export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(dir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}
