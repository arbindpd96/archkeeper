import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';

const REVISION = /^(?!-)[\w./^~@{}-]+$/;
const OUTPUT = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };

const toolName = () => path.basename(process.argv[1] ?? 'script', '.mjs');
const reasonOf = (error) => (error instanceof Error ? error.message.trim() : String(error));

/** Prints a message to stderr and exits with the given code. */
export function exitWith(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** Runs git without a shell (in `env` when given) and returns stdout, or exits 2 saying what failed and what to do. */
export function git(args, { cwd = process.cwd(), env, action, nextStep }) {
  try {
    return execFileSync('git', args, { cwd, env, ...OUTPUT });
  } catch (error) {
    return exitWith(`${toolName()}: git could not ${action} in ${cwd}.\n${reasonOf(error)}\n${nextStep}`, 2);
  }
}

/**
 * This process's environment for a git isolated from the caller's setup: no `GIT_*` variable, which could point it
 * at another repository, no system config, and only `globalConfig` as global config.
 */
export function isolatedGitEnv(globalConfig = devNull) {
  const kept = Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name));
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
}

/** Finds npm's JS entry: the npm that launched this script, else the npm installed beside this Node.js. */
function npmCli() {
  const nodeDirectory = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((file) => file !== undefined && /npm-cli\.c?js$/.test(file) && existsSync(file));
}

/**
 * Runs npm without a shell (through Node.js when npm's entry is found, else `npm` on PATH), or exits 1.
 * A failure whose message matches `tolerate` (an expected one, such as E404) returns undefined instead.
 */
export function npm(args, { cwd = process.cwd(), nextStep, tolerate }) {
  const cli = npmCli();
  const [command, prefix] = cli === undefined ? ['npm', []] : [process.execPath, [cli]];
  try {
    return execFileSync(command, [...prefix, ...args], { cwd, ...OUTPUT });
  } catch (error) {
    if (tolerate?.test(reasonOf(error))) return undefined;
    return exitWith(`${toolName()}: npm ${args[0]} failed: ${reasonOf(error)}\n${nextStep}`, 1);
  }
}

/** Returns `value` when it is a plain git revision that cannot be read as an option, else exits 2 with `usage`. */
export function gitRevision(value, usage) {
  if (typeof value === 'string' && REVISION.test(value)) return value;
  return exitWith(usage, 2);
}

/** Lists tracked and untracked (not ignored) files under `root`, or exits with git's error and `nextStep`. */
export function repositoryFiles(root, nextStep) {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  return git(args, { cwd: root, action: 'list the files', nextStep }).split('\0').filter(Boolean);
}
