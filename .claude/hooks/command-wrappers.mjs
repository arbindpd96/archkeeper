const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/*
 * Programs that run another command. `short`, `long` and `words` list the options that take a value; `operands`
 * counts the positionals before the command; `script` names the option whose value is a shell command
 * (`joinsRest` appends the remaining words to it); `evaluates` runs all remaining words as a shell command.
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
  ['xargs', { short: 'ILnPsEdaJRS', long: ['--max-args', '--max-procs', '--delimiter', '--arg-file'] }],
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
]);

// zsh expands `=cmd` to the command's path, so `=rm` runs rm.
const commandName = (word) => word.slice(word.lastIndexOf('/') + 1).replace(/^=/, '');

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

/**
 * Strips `VAR=value` prefixes and runners such as sudo, env and xargs. Returns the `program` that runs (or the
 * `script` a runner evaluates), its `args`, its index in argv, and the `assignments` and `wrappers` seen.
 */
export function unwrap(argv) {
  const found = { assignments: [], wrappers: [], script: null };
  let index = takeAssignments(argv, 0, found.assignments);
  let spec = WRAPPERS.get(commandName(argv[index] ?? ''));
  while (spec) {
    found.wrappers.push(commandName(argv[index]));
    const optionsEnd = skipOptions(argv, index + 1, spec);
    found.script = wrapperScript(argv, [index + 1, optionsEnd], spec);
    if (found.script !== null) return { ...found, programIndex: argv.length, program: '', args: [] };
    index = takeAssignments(argv, optionsEnd + (spec.operands ?? 0), found.assignments);
    spec = WRAPPERS.get(commandName(argv[index] ?? ''));
  }
  const program = commandName(argv[index] ?? '');
  return { ...found, programIndex: index, program, args: argv.slice(index + 1) };
}
