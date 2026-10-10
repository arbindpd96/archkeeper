import type { Command } from '../shell/commands.js';
import { resolveSegments } from './dangerous-paths.js';
import { classifyCode, classifyModule, type CodeKind } from './inline-code.js';
import { INTERPRETERS, type InterpreterSpec } from './interpreter-specs.js';

/** What an interpreter runs, as its arguments say. */
export interface InterpreterRun {
  /** The language it runs, such as `shell` (sh, eval, source) or `python`. */
  readonly language: string;
  /** It runs code read from stdin. */
  readonly stdin: boolean;
  /** A process substitution (`<(…)`) names its script, so another command writes the code it runs. */
  readonly substitutedScript: boolean;
  /** An expansion or a bare word names its script. */
  readonly unknownScript: boolean;
  /** An expansion names its script. */
  readonly expandedScript: boolean;
  /** Literal script paths. */
  readonly scripts: readonly string[];
  /** Each inline code or module it runs, classified. */
  readonly kinds: readonly CodeKind[];
}

interface Located {
  readonly text: string;
  readonly at: number;
}

interface Found {
  readonly codes: Located[];
  readonly modules: Located[];
  readonly scripts: Located[];
  stdin: boolean;
  wantsCode: boolean;
  stopped: boolean;
}

type LetterRole = 'code' | 'module' | 'script' | 'value';
type WordList = 'longCode' | 'longScript' | 'longValue';

const LETTER_ROLES: readonly LetterRole[] = ['code', 'module', 'script', 'value'];
const WORD_ROLES: readonly (readonly [LetterRole, WordList])[] = [
  ['code', 'longCode'],
  ['script', 'longScript'],
  ['value', 'longValue'],
];
const LIST_OF_ROLE: Partial<Record<LetterRole, 'codes' | 'modules' | 'scripts'>> = {
  code: 'codes',
  module: 'modules',
  script: 'scripts',
};
const LEADING_DIGITS = /^(?:x[\da-fA-F]*|[0-7]*)/;
const UNKNOWN_PROGRAM: InterpreterRun = {
  language: 'shell',
  stdin: true,
  substitutedScript: false,
  unknownScript: false,
  expandedScript: false,
  scripts: [],
  kinds: [],
};

interface Value {
  readonly value: { readonly text: string | undefined; readonly at: number };
  readonly width: number;
}

const isOption = (arg: string, spec: InterpreterSpec): boolean =>
  arg.length > 1 && (arg.startsWith('-') || (spec.plusOptions && arg.startsWith('+')));
const attachedValue = (text: string, at: number): Value => ({ value: { text, at }, width: 1 });
const nextValue = (args: readonly string[], index: number): Value => ({
  value: { text: args[index + 1], at: index + 1 },
  width: 2,
});

function record(found: Found, role: LetterRole, { value }: Value, spec: InterpreterSpec): void {
  const list = LIST_OF_ROLE[role];
  if (value.text === undefined || list === undefined) return;
  found[list].push({ text: value.text, at: value.at });
  if (spec.stops && role !== 'script') found.stopped = true;
}

function readWordOption(args: readonly string[], index: number, spec: InterpreterSpec, found: Found): number {
  const arg = args[index] ?? '';
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg : arg.slice(0, equals);
  if (spec.longStdin.includes(name)) found.stdin = true;
  const role = WORD_ROLES.find(([, list]) => spec[list].includes(name))?.[0];
  if (role === undefined) return 1;
  const value = equals === -1 ? nextValue(args, index) : attachedValue(arg.slice(equals + 1), index);
  record(found, role, value, spec);
  return value.width;
}

// `-c` (sh) and `-s`, `-i` (stdin) are flags whose meaning the reader records.
function markFlag(letter: string, spec: InterpreterSpec, found: Found): boolean {
  if (letter === spec.codeOperand) found.wantsCode = true;
  else if (spec.stdin.includes(letter)) found.stdin = true;
  else return false;
  return true;
}

function leadingDigits(text: string): number {
  return LEADING_DIGITS.exec(text)?.[0].length ?? 0;
}

function readCluster(args: readonly string[], index: number, spec: InterpreterSpec, found: Found): number {
  const arg = args[index] ?? '';
  for (let at = 1; at < arg.length; at += 1) {
    const letter = arg.charAt(at);
    const role = LETTER_ROLES.find((name) => spec[name].includes(letter));
    if (markFlag(letter, spec, found)) continue;
    if (spec.digits.includes(letter)) at += leadingDigits(arg.slice(at + 1));
    else if (spec.attached.includes(letter)) return 1;
    else if (role !== undefined) {
      const rest = arg.slice(at + 1);
      const value = rest ? attachedValue(rest, index) : nextValue(args, index);
      record(found, role, value, spec);
      return value.width;
    }
  }
  return 1;
}

// Where the options end if this argument ends them: `-` (the program is stdin), `--`, or the first operand.
function optionsEnd(
  args: readonly string[],
  index: number,
  spec: InterpreterSpec,
  found: Found,
): number | undefined {
  const arg = args[index] ?? '';
  if (arg === '-') {
    found.stdin = true;
    return args.length;
  }
  if (arg === '--') return spec.dashesEnd ? args.length : index + 1;
  return isOption(arg, spec) ? undefined : index;
}

// Python's -c and -m end the options too.
function readOptions(args: readonly string[], spec: InterpreterSpec, found: Found): number {
  let index = 0;
  while (index < args.length && !found.stopped) {
    const end = optionsEnd(args, index, spec, found);
    if (end !== undefined) return end;
    const read = spec.wholeWords || args[index]?.startsWith('--') === true ? readWordOption : readCluster;
    index += read(args, index, spec, found);
  }
  return found.stopped ? args.length : index;
}

function takeOperand(args: readonly string[], index: number, spec: InterpreterSpec, found: Found): void {
  const text = args[index];
  const operand = text === undefined ? null : { text, at: index };
  const hasProgram = found.codes.length + found.modules.length + found.scripts.length > 0;
  if (found.wantsCode || (spec.programOperand && !hasProgram)) {
    if (operand) found.codes.push(operand);
  } else if (!hasProgram) {
    if (operand) found.scripts.push(operand);
    else found.stdin ||= !spec.noStdin;
  }
}

function readArguments(args: readonly string[], spec: InterpreterSpec): Found {
  const found: Found = {
    codes: [],
    modules: [],
    scripts: [],
    stdin: false,
    wantsCode: false,
    stopped: false,
  };
  if (spec.allCode) return { ...found, codes: args.map((text, at) => ({ text, at })) };
  takeOperand(args, readOptions(args, spec, found), spec, found);
  return found;
}

// Anything under /dev or /proc may be stdin: /dev/fd/0, /dev//stdin, /dev/./stdin, /proc/self/fd/0.
// A relative path that climbs out first (../../dev/stdin) may reach the root, so it counts as anchored.
function isStdinPath(file: string): boolean {
  const segments = resolveSegments(file);
  const anchored = file.startsWith('/') || segments[0] === '..';
  const top = segments.find((segment) => segment !== '..') ?? '';
  return anchored && ['dev', 'proc'].includes(top);
}

// xargs appends its input as arguments, which become the program when none is given; with -I, -J or --replace
// the input fills in the replace string, which makes it code when the string sits inside the program.
function programFromXargs(found: Found, { wrappers, xargsReplace }: Command): boolean {
  if (!wrappers.includes('xargs')) return false;
  const program = [...found.codes, ...found.modules, ...found.scripts];
  if (program.length === 0) return true;
  return xargsReplace !== null && program.some(({ text }) => text.includes(xargsReplace));
}

function summarize(found: Found, spec: InterpreterSpec, command: Command): InterpreterRun {
  const expanding = ({ at }: Located): boolean => command.expands[at] ?? true;
  const literalScripts = found.scripts.filter((script) => !expanding(script));
  const kinds = [
    ...found.codes.map((code) => classifyCode(spec.language, code.text, expanding(code))),
    ...found.modules.map((module) => classifyModule(module.text, expanding(module))),
  ];
  return {
    language: spec.language,
    stdin:
      found.stdin || programFromXargs(found, command) || literalScripts.some(({ text }) => isStdinPath(text)),
    substitutedScript: found.scripts.some(({ text }) => text.startsWith('<(')),
    unknownScript: found.scripts.some((script) => expanding(script) || !/[./]/.test(script.text)),
    expandedScript: found.scripts.some(expanding),
    scripts: literalScripts.map((script) => script.text),
    kinds,
  };
}

/**
 * Reads an interpreter's arguments in order with its spec: null for other programs. A program named by an
 * expansion could be any interpreter, so it counts as reading stdin.
 */
export function readInterpreter(command: Command): InterpreterRun | null {
  if (command.dynamicProgram) return UNKNOWN_PROGRAM;
  const spec = INTERPRETERS.find(([pattern]) => pattern.test(command.program))?.[1];
  return spec === undefined ? null : summarize(readArguments(command.args, spec), spec, command);
}
