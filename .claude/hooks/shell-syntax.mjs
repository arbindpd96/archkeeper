const SHELLS = new Set([
  ...['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'pdksh', 'oksh', 'ash', 'yash', 'posh', 'rbash'],
  ...['fish', 'csh', 'tcsh'],
]);

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
