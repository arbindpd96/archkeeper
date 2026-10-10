import { expandBraces } from './braces.js';
import { readFindExpression } from './find-expression.js';
import { hasExpansion, isShell, SHELL_VALUE_OPTIONS, ShellSyntaxError } from './syntax.js';
import { newCommand, type PipePosition, type RawCommand } from './types.js';
import { tokenize } from './words.js';
import { commandName, unwrap } from './wrappers.js';

const MAX_SCRIPT_DEPTH = 8;
const MAX_ARGV = 4096;
const MAX_SCRIPT_TEXT = 64_000;
const MAX_BRACE_WORK = 1_000_000;
const MAX_ALIAS_ROUNDS = 4;

/** One simple command as the guard judges it, with wrappers unwrapped and braces expanded. */
export interface Command {
  /** The lower-cased base name of the program that runs; '' for a bare assignment. */
  readonly program: string;
  readonly args: string[];
  readonly assignments: string[];
  readonly wrappers: string[];
  readonly script: string | null;
  readonly xargsReplace: string | null;
  /** The program word holds an expansion, so it may be any program. */
  readonly dynamicProgram: boolean;
  /** The program word comes from an unquoted expansion. */
  readonly splitProgram: boolean;
  /** An argument comes from an unquoted expansion, which may add words at run time. */
  readonly splitArgs: boolean;
  /** For each argument, whether it holds an expansion. */
  readonly expands: boolean[];
  readonly definesFunction: boolean;
  readonly redirects: string[];
  readonly heredocs: string[];
  readonly pipes: PipePosition[];
  /** Commands that substitutions in its words run. */
  subs: Command[];
}

type Outer = Pick<Command, 'assignments' | 'wrappers' | 'pipes'>;
type Charge = (kind: 'text' | 'braces', amount: number) => void;

const TOP_LEVEL: Outer = { assignments: [], wrappers: [], pipes: [] };

function shellOptionsEnd(args: readonly string[]): number {
  let index = 0;
  for (let arg = args[index]; arg !== undefined && /^[-+]/.test(arg); arg = args[index]) {
    if (arg === '--' || arg === '-') return index + 1;
    index += SHELL_VALUE_OPTIONS.includes(arg) ? 2 : 1;
  }
  return index;
}

function shellScript({ args, heredocs }: Command): string | null {
  const end = shellOptionsEnd(args);
  if (args.slice(0, end).some((option) => /^-[^-]*c/.test(option))) return args[end] ?? '';
  return end >= args.length && heredocs.length > 0 ? heredocs.join('\n') : null;
}

type ScriptReader = (args: readonly string[]) => string;

// The shell code eval, trap and alias run; an alias definition's value is code once the alias is used.
const SCRIPT_PROGRAMS: ReadonlyMap<string, ScriptReader> = new Map<string, ScriptReader>([
  ['eval', (args) => args.join(' ')],
  ['trap', (args) => args[0] ?? ''],
  ['alias', (args) => args.map((definition) => definition.slice(definition.indexOf('=') + 1)).join('\n')],
]);

function innerScript(command: Command): string | null {
  if (command.script !== null) return command.script;
  const read = SCRIPT_PROGRAMS.get(command.program);
  if (read !== undefined) return read(command.args);
  return isShell(command.program) ? shellScript(command) : null;
}

// Brace expansion and nested scripts can multiply the text to inspect, so one budget caps the total work.
function workBudget(): Charge {
  const left = { text: MAX_SCRIPT_TEXT, braces: MAX_BRACE_WORK };
  return (kind, amount) => {
    left[kind] -= amount;
    if (left[kind] < 0) throw new ShellSyntaxError('more nested or expanded text than can be inspected');
  };
}

function expandArgv(
  raw: RawCommand,
  charge: Charge,
): { argv: string[]; splits: boolean[]; expands: boolean[] } {
  const expanded = { argv: [] as string[], splits: [] as boolean[], expands: [] as boolean[] };
  for (const [index, word] of raw.argv.entries()) {
    for (const alternative of expandBraces(word, raw.braces[index] ?? [], (amount) => {
      charge('braces', amount);
    })) {
      expanded.argv.push(alternative);
      expanded.splits.push(raw.splits[index] ?? false);
      expanded.expands.push(raw.expands[index] ?? false);
    }
    if (expanded.argv.length > MAX_ARGV) throw new ShellSyntaxError('a brace expansion too large to inspect');
  }
  return expanded;
}

function normalize(raw: RawCommand, outer: Outer, charge: Charge): Command {
  const { argv, splits, expands } = expandArgv(raw, charge);
  const { programIndex, argsIndex, ...command } = unwrap(argv);
  return {
    ...command,
    assignments: [...outer.assignments, ...command.assignments],
    wrappers: [...outer.wrappers, ...command.wrappers],
    dynamicProgram: hasExpansion(argv[programIndex] ?? ''),
    splitProgram: splits[programIndex] ?? false,
    splitArgs: splits.slice(argsIndex).some(Boolean),
    expands: expands.slice(argsIndex),
    definesFunction: raw.definesFunction,
    redirects: raw.redirects,
    heredocs: raw.heredocs,
    pipes: [...raw.pipes, ...outer.pipes],
    subs: [],
  };
}

function findExecs(command: Command, depth: number, charge: Charge): Command[] {
  const outer = { ...command, wrappers: [...command.wrappers, 'find'] };
  return readFindExpression(command.args).tokens.flatMap((token) => {
    if (typeof token === 'string') return [];
    const expands = command.expands.slice(token.start, token.start + token.exec.length);
    const raw: RawCommand = { ...newCommand(), argv: token.exec, expands };
    const exec = normalize(raw, outer, charge);
    return [exec, ...nestedCommands(exec, depth + 1, charge)];
  });
}

function nestedCommands(command: Command, depth: number, charge: Charge): Command[] {
  if (depth > MAX_SCRIPT_DEPTH) throw new ShellSyntaxError('shells nested too deeply');
  const script = innerScript(command);
  const nested = script === null ? [] : parseScript(script, command, depth + 1, charge);
  return command.program === 'find' ? [...nested, ...findExecs(command, depth, charge)] : nested;
}

function parseScript(source: string, outer: Outer, depth: number, charge: Charge): Command[] {
  charge('text', source.length);
  const raws = tokenize(source);
  const normalized = new Map(raws.map((raw) => [raw, normalize(raw, outer, charge)]));
  const commands: Command[] = [];
  for (const [raw, command] of normalized) {
    command.subs = raw.subs.flatMap((sub) => normalized.get(sub) ?? []);
    commands.push(command, ...nestedCommands(command, depth, charge));
  }
  return commands;
}

function aliasDefinitions(commands: readonly Command[]): [name: string, value: string][] {
  return commands
    .filter(({ program, definesFunction }) => program === 'alias' && !definesFunction)
    .flatMap(({ args }) => args.filter((arg) => arg.includes('=')))
    .map((definition) => {
      const equals = definition.indexOf('=');
      return [commandName(definition.slice(0, equals)), definition.slice(equals + 1)];
    });
}

// The use's literal words are quoted again; a word with an expansion keeps its source text, so it still expands.
function aliasUse(value: string, { args, expands }: Command): string {
  const words = args.map((arg, index) =>
    expands[index] === true ? arg : `'${arg.replaceAll("'", `'\\''`)}'`,
  );
  return [value, ...words].join(' ');
}

// bash expands an alias defined earlier in a -c or eval string, so a command named like any alias of the line is
// also judged as the alias value followed by its arguments: `alias x=rm` then `x -fr /` is `rm -fr /`.
function aliasExpansions(commands: readonly Command[], charge: Charge): Command[] {
  const aliases = aliasDefinitions(commands);
  const expanded: Command[] = [];
  let uses = commands;
  for (let round = 0; round < MAX_ALIAS_ROUNDS && aliases.length > 0 && uses.length > 0; round += 1) {
    uses = uses.flatMap((use) =>
      aliases
        .filter(([name]) => name === use.program && !use.dynamicProgram && !use.definesFunction)
        .flatMap(([, value]) => parseScript(aliasUse(value, use), use, 1, charge)),
    );
    expanded.push(...uses);
  }
  return expanded;
}

/**
 * Parses shell source into the simple commands the guard judges. Braces are expanded, and code run by `sh -c`,
 * `eval`, `env -S`, `trap`, `alias`, `watch`, `su -c`, `find -exec` or a here-document fed to a shell is parsed
 * too, inheriting the outer assignments, wrappers and pipes; so is each use of an alias. Throws ShellSyntaxError
 * when it cannot.
 */
export function parseCommands(source: string): Command[] {
  const charge = workBudget();
  const commands = parseScript(source, TOP_LEVEL, 0, charge);
  return [...commands, ...aliasExpansions(commands, charge)];
}
