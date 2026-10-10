import type { Command } from '../shell/commands.js';
import { hasExpansion } from '../shell/syntax.js';
import { hasLong, type ParsedOptions } from './cli-options.js';
import type { JudgeContext } from './judge-context.js';
import { ask, type Verdict } from './verdicts.js';

const DISCARDS_WORK = ask('This discards work irreversibly. Confirm with the user.');

/** Judges `git checkout`: forcing it, or naming paths as `git checkout <rev> <file>` does, discards edits unasked. */
export function judgeCheckout(
  options: ParsedOptions,
  _command: Command,
  { exists }: JudgeContext,
): Verdict | null {
  const forced = options.short.has('f') || options.long.has('--force');
  const createsBranch = options.short.has('b') || options.short.has('B') || options.long.has('--orphan');
  const { operands } = options;
  const isExistingPath = (operand: string): boolean => !hasExpansion(operand) && exists(operand);
  const namesPaths = !createsBranch && (operands.length > 1 || operands.some(isExistingPath));
  const discardsPaths = options.afterDashes.length > 0 || operands.includes('.') || namesPaths;
  return forced || discardsPaths ? DISCARDS_WORK : null;
}

/** Judges `git restore`: anything but restoring the index alone discards edits in the working tree. */
export function judgeRestore(options: ParsedOptions): Verdict | null {
  const staged = options.short.has('S') || hasLong(options, '--staged', 5);
  const worktree = options.short.has('W') || hasLong(options, '--worktree', 4);
  return staged && !worktree ? null : DISCARDS_WORK;
}

/** Judges `git switch`: discarding changes or recreating a branch loses work. */
export function judgeSwitch(options: ParsedOptions): Verdict | null {
  const discards =
    options.short.has('f') || options.long.has('--force') || hasLong(options, '--discard-changes', 4);
  const recreates = options.short.has('C') || hasLong(options, '--force-create', 9);
  return discards || recreates ? DISCARDS_WORK : null;
}

/** Judges `git branch`: force-deleting, moving or copying over a branch loses its commits. */
export function judgeBranch(options: ParsedOptions): Verdict | null {
  const forced = ['D', 'f', 'M', 'C'].some((flag) => options.short.has(flag)) || options.long.has('--force');
  return forced ? DISCARDS_WORK : null;
}
