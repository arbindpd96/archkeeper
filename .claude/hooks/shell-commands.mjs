import { expandBraces } from './brace-expansion.mjs';
import { unwrap } from './command-wrappers.mjs';
import { readFindExpression } from './find-expression.mjs';
import { ShellSyntaxError, tokenize } from './shell-words.mjs';

const MAX_SCRIPT_DEPTH = 8;
const MAX_ARGV = 4096;
const MAX_SCRIPT_TEXT = 64_000;
const MAX_BRACE_WORK = 1_000_000;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'mksh', 'fish']);
const SHELL_VALUE_OPTIONS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const TOP_LEVEL = { assignments: [], wrappers: [], pipes: [] };

function shellOptionsEnd(args) {
  let index = 0;
  while (index < args.length && /^[-+]/.test(args[index])) {
    if (args[index] === '--' || args[index] === '-') return index + 1;
    index += SHELL_VALUE_OPTIONS.has(args[index]) ? 2 : 1;
  }
  return index;
}

function shellScript({ args, heredocs }) {
  const end = shellOptionsEnd(args);
  if (args.slice(0, end).some((option) => /^-[^-]*c/.test(option))) return args[end] ?? '';
  return end >= args.length && heredocs.length > 0 ? heredocs.join('\n') : null;
}

function innerScript(command) {
  const { script, program, args } = command;
  if (script !== null) return script;
  if (program === 'eval') return args.join(' ');
  if (program === 'trap') return args[0] ?? '';
  if (program === 'alias')
    return args.map((definition) => definition.slice(definition.indexOf('=') + 1)).join('\n');
  return SHELLS.has(program) ? shellScript(command) : null;
}

const findExecSegments = (args) =>
  readFindExpression(args)
    .tokens.filter((token) => typeof token === 'object')
    .map((token) => token.exec);

// Brace expansion and nested scripts can multiply the text to inspect, so one budget caps the total work.
function workBudget() {
  const left = { text: MAX_SCRIPT_TEXT, braces: MAX_BRACE_WORK };
  return (kind, amount) => {
    left[kind] -= amount;
    if (left[kind] < 0) throw new ShellSyntaxError('more nested or expanded text than can be inspected');
  };
}

function expandArgv({ argv, braces, splits }, charge) {
  const expanded = { argv: [], splits: [] };
  const chargeBraces = (amount) => charge('braces', amount);
  argv.forEach((word, index) => {
    for (const alternative of expandBraces(word, braces[index] ?? [], chargeBraces)) {
      expanded.argv.push(alternative);
      expanded.splits.push(splits[index] ?? false);
    }
    if (expanded.argv.length > MAX_ARGV) throw new ShellSyntaxError('a brace expansion too large to inspect');
  });
  return expanded;
}

function normalize(raw, outer, charge) {
  const { argv, splits } = expandArgv(raw, charge);
  const { programIndex, ...command } = unwrap(argv);
  return {
    ...command,
    assignments: [...outer.assignments, ...command.assignments],
    wrappers: [...outer.wrappers, ...command.wrappers],
    dynamicProgram: /[$`]/.test(argv[programIndex] ?? ''),
    splitProgram: splits[programIndex] ?? false,
    splitArgs: splits.slice(programIndex + 1).some(Boolean),
    redirects: raw.redirects,
    heredocs: raw.heredocs,
    pipes: [...raw.pipes, ...outer.pipes],
    subs: raw.subs,
  };
}

function nestedCommands(command, depth, charge) {
  if (depth > MAX_SCRIPT_DEPTH) throw new ShellSyntaxError('shells nested too deeply');
  const script = innerScript(command);
  const nested = script === null ? [] : parseScript(script, command, depth + 1, charge);
  if (command.program !== 'find') return nested;
  const outer = { ...command, wrappers: [...command.wrappers, 'find'] };
  for (const argv of findExecSegments(command.args)) {
    const raw = { argv, braces: [], splits: [], redirects: [], heredocs: [], subs: [], pipes: [] };
    const exec = normalize(raw, outer, charge);
    nested.push(exec, ...nestedCommands(exec, depth + 1, charge));
  }
  return nested;
}

function parseScript(source, outer, depth, charge) {
  charge('text', source.length);
  const normalized = new Map(tokenize(source).map((raw) => [raw, normalize(raw, outer, charge)]));
  const commands = [];
  for (const command of normalized.values()) {
    command.subs = command.subs.map((sub) => normalized.get(sub));
    commands.push(command, ...nestedCommands(command, depth, charge));
  }
  return commands;
}

/**
 * Parses shell source into simple commands with `program` (basename), `args`, `assignments`, `wrappers`,
 * `redirects`, `heredocs`, `pipes`, `subs`, and whether the program or its arguments come from an unquoted
 * expansion. Braces are expanded, and code run by `sh -c`, `eval`, `env -S`, `trap`, `alias`, `watch`, `su -c`,
 * `find -exec` or a here-document fed to a shell is parsed too, inheriting the outer assignments, wrappers and pipes.
 */
export function parseCommands(source) {
  return parseScript(source, TOP_LEVEL, 0, workBudget());
}
