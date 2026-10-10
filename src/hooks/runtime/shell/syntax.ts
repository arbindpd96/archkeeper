const SHELLS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'pdksh',
  'oksh',
  'ash',
  'yash',
  'posh',
  'rbash',
  'fish',
  'csh',
  'tcsh',
]);

const ASSIGNMENT = /^[A-Za-z_]\w*\+?=/;

/** Shell options that take the next word as their value, shared by the parser and the interpreter reader. */
export const SHELL_VALUE_OPTIONS: readonly string[] = ['-o', '+o', '-O', '+O', '--rcfile', '--init-file'];

/** Raised when a command is malformed or parses differently across shells, so it cannot be judged. */
export class ShellSyntaxError extends Error {
  override name = 'ShellSyntaxError';
}

/** Tells whether a program is a shell that runs `-c` code, a script file or stdin. */
export function isShell(program: string): boolean {
  return SHELLS.has(program);
}

/** The shell program names, for building matchers. */
export function shellNames(): string[] {
  return [...SHELLS];
}

/** Tells whether a word holds a `$` or backtick expansion; it errs towards yes, since quoting is gone. */
export function hasExpansion(word: string): boolean {
  return /[$`]/.test(word);
}

/** Tells whether a word starts with a `NAME=` or `NAME+=` variable assignment. */
export function isAssignment(word: string): boolean {
  return ASSIGNMENT.test(word);
}
