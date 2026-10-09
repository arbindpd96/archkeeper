import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Prints a message to stderr and exits with the given code. */
export function exitWith(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** Runs git without a shell and returns stdout, or exits 2 saying what could not be done and what to do next. */
export function git(args, { cwd = process.cwd(), action, nextStep }) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const tool = path.basename(process.argv[1] ?? 'script', '.mjs');
    const reason = error instanceof Error ? error.message.trim() : String(error);
    return exitWith(`${tool}: git could not ${action} in ${cwd}.\n${reason}\n${nextStep}`, 2);
  }
}

/** Lists tracked and untracked (not ignored) files under `root`, or exits with git's error and `nextStep`. */
export function repositoryFiles(root, nextStep) {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  return git(args, { cwd: root, action: 'list the files', nextStep }).split('\0').filter(Boolean);
}
