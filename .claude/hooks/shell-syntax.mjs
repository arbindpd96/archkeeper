const SHELLS = new Set([
  ...['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'pdksh', 'oksh', 'ash', 'yash', 'posh', 'rbash'],
  ...['fish', 'csh', 'tcsh'],
]);

const ASSIGNMENT = /^[A-Za-z_]\w*\+?=/;

/** Shell options that take the next word as their value, shared by the parser and the interpreter reader. */
export const SHELL_VALUE_OPTIONS = ['-o', '+o', '-O', '+O', '--rcfile', '--init-file'];

/** Tells whether a program is a shell that runs `-c` code, a script file or stdin. */
export function isShell(program) {
  return SHELLS.has(program);
}

/** Lists the shell program names, for building matchers. */
export function shellNames() {
  return [...SHELLS];
}

/** Tells whether a word holds a `$` or backtick expansion; it errs towards yes, since quoting is gone. */
export function hasExpansion(word) {
  return /[$`]/.test(word);
}

/** Tells whether a word starts with a `NAME=` or `NAME+=` variable assignment. */
export function isAssignment(word) {
  return ASSIGNMENT.test(word);
}
