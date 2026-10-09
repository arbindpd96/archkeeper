import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const TEST_IDENTITY = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];

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
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Creates a throwaway git repository whose first commit contains the given files. */
export function tempRepo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codekit-test-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
  writeFiles(dir, files);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git(...TEST_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'init');
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
