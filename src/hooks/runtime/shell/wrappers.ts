import { isAssignment } from './syntax.js';
import { WRAPPERS, type WrapperSpec } from './wrapper-specs.js';

/** A command with its `VAR=value` prefixes and runners such as sudo, env and xargs stripped. */
export interface Unwrapped {
  readonly assignments: string[];
  readonly wrappers: string[];
  /** The shell command a runner evaluates, such as `env -S`'s, or null. */
  readonly script: string | null;
  /** The string xargs replaces with its input (`-I`, `-J`, `--replace`), or null when it appends the input. */
  readonly xargsReplace: string | null;
  readonly programIndex: number;
  readonly argsIndex: number;
  readonly program: string;
  readonly args: string[];
}

interface Found {
  readonly assignments: string[];
  readonly wrappers: string[];
  script: string | null;
  xargsReplace: string | null;
}

/** The program a word names: its base name without zsh's `=` prefix, lower-cased since macOS ignores case. */
export function commandName(word: string): string {
  return word
    .slice(word.lastIndexOf('/') + 1)
    .replace(/^=/, '')
    .toLowerCase();
}

function runnerAt(argv: readonly string[], index: number): WrapperSpec | undefined {
  const spec = WRAPPERS.get(commandName(argv[index] ?? ''));
  if (spec?.subcommand === undefined) return spec;
  return argv[index + 1] === spec.subcommand ? spec : undefined;
}

function takeAssignments(argv: readonly string[], start: number, assignments: string[]): number {
  let index = start;
  while (index < argv.length && isAssignment(argv[index] ?? '')) {
    assignments.push(argv[index] ?? '');
    index += 1;
  }
  return index;
}

function optionWidth(option: string, spec: WrapperSpec): number {
  if (spec.words?.includes(option)) return 2;
  if (option.startsWith('--')) return !option.includes('=') && spec.long?.includes(option) ? 2 : 1;
  const valueAt = option
    .slice(1)
    .split('')
    .findIndex((flag) => spec.short?.includes(flag));
  return valueAt === option.length - 2 ? 2 : 1;
}

function skipOptions(argv: readonly string[], start: number, spec: WrapperSpec): number {
  let index = start;
  for (let word = argv[index]; word?.startsWith('-') === true && word !== '-'; word = argv[index]) {
    if (word === '--') return index + 1;
    index += optionWidth(word, spec);
  }
  return index;
}

function clusterScriptValue(
  cluster: string,
  next: string | undefined,
  letter: string,
  valueFlags: string,
): string | null {
  for (let at = 1; at < cluster.length; at += 1) {
    if (cluster[at] === letter) return cluster.slice(at + 1) || (next ?? '');
    if (valueFlags.includes(cluster[at] ?? '')) return null;
  }
  return null;
}

function scriptValueAt(word: string, next: string | undefined, spec: WrapperSpec): string | null {
  if (spec.script === undefined) return null;
  const [letter, longName] = spec.script;
  if (word === longName) return next ?? '';
  if (word.startsWith(`${longName}=`)) return word.slice(longName.length + 1);
  return /^-[^-]/.test(word) ? clusterScriptValue(word, next, letter, spec.short ?? '') : null;
}

function wrapperScript(
  argv: readonly string[],
  start: number,
  optionsEnd: number,
  spec: WrapperSpec,
): string | null {
  if (spec.evaluates === true) return argv.slice(optionsEnd).join(' ');
  const end = Math.min(argv.length, optionsEnd + (spec.operands ?? 0) + 1);
  for (let index = start; index < end; index += 1) {
    const value = scriptValueAt(argv[index] ?? '', argv[index + 1], spec);
    if (value !== null) return spec.joinsRest === true ? [value, ...argv.slice(optionsEnd)].join(' ') : value;
  }
  return null;
}

function replaceOption(option: string, next: string | undefined): string | null {
  if (option === '--replace' || option.startsWith('--replace=')) return option.slice(10) || '{}';
  const at = option.startsWith('--') ? -1 : option.search(/[IJi]/);
  if (at < 1) return null;
  const attached = option.slice(at + 1);
  return attached || (option[at] === 'i' ? '{}' : (next ?? ''));
}

// xargs -I, -J, -i and --replace put each input item inside the command's words instead of appending it.
function replaceString(options: readonly string[]): string | null {
  for (const [index, option] of options.entries()) {
    const replace = replaceOption(option, options[index + 1]);
    if (replace !== null) return replace;
  }
  return null;
}

function readRunner(argv: readonly string[], index: number, spec: WrapperSpec, found: Found): number {
  found.wrappers.push(commandName(argv[index] ?? ''));
  const optionsEnd = skipOptions(argv, index + (spec.subcommand === undefined ? 1 : 2), spec);
  found.script = wrapperScript(argv, index + 1, optionsEnd, spec);
  if (spec.replaces === true) found.xargsReplace = replaceString(argv.slice(index + 1, optionsEnd));
  return optionsEnd;
}

/**
 * Strips `VAR=value` prefixes and runners such as sudo, env and xargs from a command's words: the `program` that
 * runs (or the `script` a runner evaluates), its `args`, and the assignments and wrappers seen on the way.
 */
export function unwrap(argv: readonly string[]): Unwrapped {
  const found: Found = { assignments: [], wrappers: [], script: null, xargsReplace: null };
  let index = takeAssignments(argv, 0, found.assignments);
  let spec = runnerAt(argv, index);
  let stdinProgram: string | null = null;
  while (spec !== undefined) {
    const optionsEnd = readRunner(argv, index, spec, found);
    if (found.script !== null) {
      return { ...found, programIndex: argv.length, argsIndex: argv.length, program: '', args: [] };
    }
    index = takeAssignments(argv, optionsEnd + (spec.operands ?? 0), found.assignments);
    stdinProgram = spec.stdinProgram ?? null;
    spec = runnerAt(argv, index);
  }
  // `uv run -` runs a Python script read from stdin, so it is judged as `python -` with `-` as the first arg.
  const impliedProgram = stdinProgram !== null && argv[index] === '-';
  const program = impliedProgram ? (stdinProgram ?? '') : commandName(argv[index] ?? '');
  const argsIndex = impliedProgram ? index : index + 1;
  return { ...found, programIndex: index, argsIndex, program, args: argv.slice(argsIndex) };
}
