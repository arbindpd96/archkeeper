import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * `process.env` with `overrides` applied. An override also drops every name that differs from it only in
 * case: on Windows, vitest gives its workers an uppercase copy of every variable, and Node passes a child
 * only the lexicographically first of such names, so `NPM_EXECPATH` would beat an `npm_execpath` override.
 */
export function withEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const overridden = new Set(Object.keys(overrides).map((name) => name.toLowerCase()));
  const kept = Object.entries(process.env).filter(([name]) => !overridden.has(name.toLowerCase()));
  return { ...Object.fromEntries(kept), ...overrides };
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
    env: withEnv(options.env),
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

/** Runs git in `dir` with an isolated global config and the test identity, returning stdout. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', [...TEST_GIT_CONFIG, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: SCRIPT_TIMEOUT_MS,
    env: { ...process.env, ...ISOLATED_GIT_ENV },
  });
}

/** Creates a throwaway git repository whose first commit contains the given files. */
export function tempRepo(files: Record<string, string> = {}): string {
  const dir = tempDir();
  writeFiles(dir, files);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

/** Writes and commits files in a temp repo, as `author` ("Name <email>") when given; returns the commit SHA. */
export function commitFiles(
  dir: string,
  files: Record<string, string>,
  commit: { message: string; author?: string },
): string {
  writeFiles(dir, files);
  git(dir, 'add', '-A');
  const author = commit.author === undefined ? [] : ['--author', commit.author];
  git(dir, 'commit', '-q', '--allow-empty', '-m', commit.message, ...author);
  return git(dir, 'rev-parse', 'HEAD').trim();
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

/** Writes an executable `name` script into a fresh temp folder and returns it, to put a stand-in tool on PATH. */
export function fakeBin(name: string, script: string): string {
  const dir = tempDir();
  writeFiles(dir, { [name]: script });
  chmodSync(path.join(dir, name), 0o755);
  return dir;
}

const GIF_HEADER = [...Buffer.from('GIF89a', 'latin1'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];

/** A 1×1 GIF whose frames last `delays` hundredths of a second, padded by a comment of about `padBytes`. */
export function gifBytes(delays: number[], padBytes = 0): Buffer {
  const frames = delays.flatMap((delay) => [
    ...[0x21, 0xf9, 4, 0, delay & 0xff, delay >> 8, 0, 0],
    ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
    ...[2, 2, 0x44, 0x01, 0],
  ]);
  const subBlocks = Math.ceil(padBytes / 255);
  const comment = Buffer.alloc(subBlocks === 0 ? 0 : 3 + subBlocks * 256);
  if (subBlocks > 0) comment.set([0x21, 0xfe]);
  for (let index = 0; index < subBlocks; index += 1) comment[2 + index * 256] = 255;
  return Buffer.concat([Buffer.from(GIF_HEADER), Buffer.from(frames), comment, Buffer.from([0x3b])]);
}
