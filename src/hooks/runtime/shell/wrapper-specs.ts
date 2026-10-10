/**
 * How a program that runs another command reads its arguments. `short`, `long` and `words` list the options
 * that take a value; `operands` counts the positionals before the command; `script` names the option whose value
 * is a shell command (`joinsRest` appends the remaining words to it); `evaluates` runs all remaining words as a
 * shell command; `subcommand` is the word that must follow for the program to act as a runner; `stdinProgram`
 * is what runs when the command is `-`; `replaces` reads xargs' replace string.
 */
export interface WrapperSpec {
  readonly short?: string;
  readonly long?: readonly string[];
  readonly words?: readonly string[];
  readonly operands?: number;
  readonly script?: readonly [letter: string, longName: string];
  readonly joinsRest?: boolean;
  readonly evaluates?: boolean;
  readonly subcommand?: string;
  readonly stdinProgram?: string;
  readonly replaces?: boolean;
}

const UV_RUN_VALUES: readonly string[] = [
  ...['--with', '--with-editable', '--with-requirements', '--python', '--project', '--directory'],
  ...['--env-file', '--extra', '--group', '--only-group', '--no-group', '--package', '--index'],
  ...['--default-index', '--index-url', '--extra-index-url', '--find-links', '--config-file', '--cache-dir'],
  ...['--color', '--resolution', '--prerelease', '--exclude-newer', '--link-mode', '--index-strategy'],
  ...['--keyring-provider', '--python-platform', '--allow-insecure-host', '--upgrade-package'],
  ...['--reinstall-package', '--refresh-package', '--config-setting', '--config-settings-package'],
  ...[
    '--no-extra',
    '--exclude-newer-package',
    '--fork-strategy',
    '--no-binary-package',
    '--no-build-package',
  ],
  '--torch-backend',
];
// `uvx` (uv tool run) also takes `--from`, naming the package that provides the command.
const UVX_VALUES: readonly string[] = [...UV_RUN_VALUES, '--from'];

/** Programs that run another command, by name. */
export const WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map<string, WrapperSpec>([
  ['sudo', { short: 'ugCDhprtUTR', long: ['--user', '--group', '--chdir', '--host', '--prompt', '--role'] }],
  ['doas', { short: 'uC' }],
  [
    'su',
    { short: 'sgGcw', long: ['--shell', '--group', '--command'], script: ['c', '--command'], operands: 1 },
  ],
  [
    'env',
    {
      short: 'uCS',
      long: ['--unset', '--chdir', '--split-string'],
      script: ['S', '--split-string'],
      joinsRest: true,
    },
  ],
  ['command', {}],
  ['builtin', {}],
  ['exec', { short: 'a' }],
  ['nohup', {}],
  ['time', { short: 'of', long: ['--output', '--format'] }],
  ['nice', { short: 'n', long: ['--adjustment'] }],
  ['timeout', { short: 'sk', long: ['--signal', '--kill-after'], operands: 1 }],
  [
    'xargs',
    {
      short: 'ILnPsEdaJRS',
      long: ['--max-args', '--max-procs', '--delimiter', '--arg-file'],
      replaces: true,
    },
  ],
  ['stdbuf', { short: 'ioe', long: ['--input', '--output', '--error'] }],
  ['setsid', {}],
  ['caffeinate', { short: 'wt' }],
  ['chroot', { long: ['--userspec', '--groups'], operands: 1 }],
  ['ionice', { short: 'cnpPu', long: ['--class', '--classdata', '--pid', '--pgid', '--uid'] }],
  ['taskset', { operands: 1 }],
  ['unbuffer', {}],
  ['nsenter', { short: 'tSG', long: ['--target', '--setuid', '--setgid'] }],
  ['arch', { words: ['-arch', '-e'] }],
  ['flock', { short: 'wEc', long: ['--timeout', '--command'], script: ['c', '--command'], operands: 1 }],
  ['script', { short: 'tc', long: ['--timing', '--command'], script: ['c', '--command'], operands: 1 }],
  ['watch', { short: 'nq', long: ['--interval'], evaluates: true }],
  ['noglob', {}],
  ['nocorrect', {}],
  ['repeat', { operands: 1 }],
  ['busybox', {}],
  ['uv', { subcommand: 'run', short: 'pfPC', long: UV_RUN_VALUES, stdinProgram: 'python' }],
  ['uvx', { short: 'pfPC', long: UVX_VALUES }],
]);
