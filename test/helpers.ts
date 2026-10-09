import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  options: { payload?: unknown; args?: string[]; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): RunResult {
  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, script), ...(options.args ?? [])], {
    cwd: options.cwd,
    input: options.payload === undefined ? '' : JSON.stringify(options.payload),
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    timeout: SCRIPT_TIMEOUT_MS,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Reads the permission decision a PreToolUse hook printed; no output means the tool call is allowed. */
export function permissionDecision(stdout: string): string {
  if (!stdout) return 'allow';
  const output = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: string } };
  return output.hookSpecificOutput?.permissionDecision ?? 'allow';
}

/** A PreToolUse hook's permission decision and its reason (empty when it allowed without output). */
export interface HookVerdict {
  decision: string;
  reason: string;
}

/** Runs a `.claude/hooks/` PreToolUse hook on a tool input and returns its decision and reason. */
export function hookVerdict(hook: string, toolInput: unknown, env: NodeJS.ProcessEnv = {}): HookVerdict {
  const { stdout } = runScript(`.claude/hooks/${hook}`, { payload: { tool_input: toolInput }, env });
  if (!stdout) return { decision: 'allow', reason: '' };
  const output = JSON.parse(stdout) as {
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
  };
  const { permissionDecision: decision = 'allow', permissionDecisionReason: reason = '' } =
    output.hookSpecificOutput ?? {};
  return { decision, reason };
}

/** Runs a `.claude/hooks/` PreToolUse hook on a tool input and returns its permission decision. */
export function hookDecision(hook: string, toolInput: unknown, env: NodeJS.ProcessEnv = {}): string {
  return hookVerdict(hook, toolInput, env).decision;
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

/** A fixture project copied out of `examples/`, with the environment to run tools in it. */
export interface FixtureCopy {
  dir: string;
  /** `process.env` with HOME and the global git config moved into the temp dir. */
  env: NodeJS.ProcessEnv;
}

const FIXTURE_GIT_CONFIG = [
  '[user]',
  '\tname = test',
  '\temail = test@example.com',
  '[init]',
  '\tdefaultBranch = main',
  '[commit]',
  '\tgpgsign = false',
  '',
].join('\n');

/** Copies `examples/<name>` under a path with a space and non-ASCII characters, isolated from the real HOME. */
export function fixtureCopy(name: string): FixtureCopy {
  const source = path.join(REPO_ROOT, 'examples', name);
  if (!existsSync(source)) throw new Error(`No fixture examples/${name}; see the examples/ folder.`);
  const root = tempDir();
  const dir = path.join(root, 'my project é', name);
  const home = path.join(root, 'home');
  cpSync(source, dir, { recursive: true });
  writeFiles(home, { '.gitconfig': FIXTURE_GIT_CONFIG });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  return { dir, env };
}
