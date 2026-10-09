const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const UV_RUN_VALUES = [
  '--with',
  '--with-editable',
  '--with-requirements',
  '--python',
  '--project',
  '--directory',
  '--env-file',
  '--extra',
  '--group',
  '--only-group',
  '--no-group',
  '--package',
  '--index',
  '--default-index',
  '--index-url',
  '--extra-index-url',
  '--find-links',
  '--config-file',
  '--cache-dir',
  '--color',
  '--resolution',
  '--prerelease',
  '--exclude-newer',
  '--link-mode',
  '--index-strategy',
  '--keyring-provider',
  '--python-platform',
  '--allow-insecure-host',
  '--upgrade-package',
  '--reinstall-package',
  '--refresh-package',
  '--config-setting',
];

/*
 * Programs that run another command. `short`, `long` and `words` list the options that take a value; `operands`
 * counts the positionals before the command; `script` names the option whose value is a shell command
 * (`joinsRest` appends the remaining words to it); `evaluates` runs all remaining words as a shell command;
 * `subcommand` is the word that must follow for the program to act as a runner; `stdinProgram` is what runs
 * when the command is `-`; `replaces` reads xargs' replace string.
 */
const WRAPPERS = new Map([
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
]);

// zsh expands `=cmd` to the command's path, so `=rm` runs rm. macOS file systems ignore case, so `RM` runs rm too.
const commandName = (word) =>
  word
    .slice(word.lastIndexOf('/') + 1)
    .replace(/^=/, '')
    .toLowerCase();

function runnerAt(argv, index) {
  const spec = WRAPPERS.get(commandName(argv[index] ?? ''));
  if (!spec?.subcommand) return spec;
  return argv[index + 1] === spec.subcommand ? spec : undefined;
}

function takeAssignments(argv, start, assignments) {
  let index = start;
  for (; index < argv.length && ASSIGNMENT.test(argv[index]); index += 1) assignments.push(argv[index]);
  return index;
}

function optionWidth(option, spec) {
  if (spec.words?.includes(option)) return 2;
  if (option.startsWith('--')) return !option.includes('=') && spec.long?.includes(option) ? 2 : 1;
  const valueAt = [...option.slice(1)].findIndex((flag) => spec.short?.includes(flag));
  return valueAt === option.length - 2 ? 2 : 1;
}

function skipOptions(argv, start, spec) {
  let index = start;
  while (index < argv.length && argv[index].startsWith('-') && argv[index] !== '-') {
    if (argv[index] === '--') return index + 1;
    index += optionWidth(argv[index], spec);
  }
  return index;
}

function clusterScriptValue(cluster, next, letter, valueFlags) {
  for (let at = 1; at < cluster.length; at += 1) {
    if (cluster[at] === letter) return cluster.slice(at + 1) || (next ?? '');
    if (valueFlags.includes(cluster[at])) return null;
  }
  return null;
}

function scriptValueAt(word, next, spec) {
  const [letter, longName] = spec.script;
  if (word === longName) return next ?? '';
  if (word.startsWith(`${longName}=`)) return word.slice(longName.length + 1);
  return /^-[^-]/.test(word) ? clusterScriptValue(word, next, letter, spec.short ?? '') : null;
}

function wrapperScript(argv, [start, optionsEnd], spec) {
  if (spec.evaluates) return argv.slice(optionsEnd).join(' ');
  const end = Math.min(argv.length, optionsEnd + (spec.operands ?? 0) + 1);
  for (let index = start; spec.script && index < end; index += 1) {
    const value = scriptValueAt(argv[index], argv[index + 1], spec);
    if (value !== null) return spec.joinsRest ? [value, ...argv.slice(optionsEnd)].join(' ') : value;
  }
  return null;
}

function replaceOption(option, next) {
  if (option === '--replace' || option.startsWith('--replace=')) return option.slice(10) || '{}';
  const at = option.startsWith('--') ? -1 : option.search(/[IJi]/);
  if (at < 1) return null;
  const attached = option.slice(at + 1);
  return attached || (option[at] === 'i' ? '{}' : (next ?? ''));
}

// xargs -I, -J, -i and --replace put each input item inside the command's words instead of appending it.
function replaceString(options) {
  for (let index = 0; index < options.length; index += 1) {
    const replace = replaceOption(options[index], options[index + 1]);
    if (replace !== null) return replace;
  }
  return null;
}

function readRunner(argv, index, spec, found) {
  found.wrappers.push(commandName(argv[index]));
  const optionsEnd = skipOptions(argv, index + (spec.subcommand ? 2 : 1), spec);
  found.script = wrapperScript(argv, [index + 1, optionsEnd], spec);
  if (spec.replaces) found.xargsReplace = replaceString(argv.slice(index + 1, optionsEnd));
  return optionsEnd;
}

/**
 * Strips `VAR=value` prefixes and runners such as sudo, env and xargs. Returns the `program` that runs (or the
 * `script` a runner evaluates), its `args`, its index in argv, the `assignments` and `wrappers` seen, and the
 * `xargsReplace` string that xargs substitutes its input for (null when it appends the input instead).
 */
export function unwrap(argv) {
  const found = { assignments: [], wrappers: [], script: null, xargsReplace: null };
  let index = takeAssignments(argv, 0, found.assignments);
  let spec = runnerAt(argv, index);
  let stdinProgram = null;
  while (spec) {
    const optionsEnd = readRunner(argv, index, spec, found);
    if (found.script !== null) return { ...found, programIndex: argv.length, program: '', args: [] };
    index = takeAssignments(argv, optionsEnd + (spec.operands ?? 0), found.assignments);
    stdinProgram = spec.stdinProgram ?? null;
    spec = runnerAt(argv, index);
  }
  // `uv run -` runs a Python script read from stdin, so it is judged as `python -`.
  if (stdinProgram && argv[index] === '-') {
    return { ...found, programIndex: index - 1, program: stdinProgram, args: argv.slice(index) };
  }
  const program = commandName(argv[index] ?? '');
  return { ...found, programIndex: index, program, args: argv.slice(index + 1) };
}
