import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Prints a message to stderr and exits with the given code. */
export function exitWith(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** Lists tracked and untracked (not ignored) files under `root`, or exits with git's error and `nextStep`. */
export function repositoryFiles(root, nextStep) {
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split('\0').filter(Boolean);
  } catch (error) {
    const tool = path.basename(process.argv[1] ?? 'script', '.mjs');
    const reason = error instanceof Error ? error.message.trim() : String(error);
    return exitWith(`${tool}: git could not list the files in ${root}.\n${reason}\n${nextStep}`, 2);
  }
}
