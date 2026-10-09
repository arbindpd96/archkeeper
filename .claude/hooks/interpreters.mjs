import { classifyCode, classifyModule } from './inline-code.mjs';
import { SHELL_VALUE_OPTIONS, shellNames } from './shell-syntax.mjs';

const SHELL_SHORT_VALUES = SHELL_VALUE_OPTIONS.filter((option) => option.length === 2)
  .map((option) => option[1])
  .join('');
const SHELL_LONG_VALUES = SHELL_VALUE_OPTIONS.filter((option) => option.startsWith('--'));

/*
 * Option specs. Letters in `code`, `module`, `script` and `value` take a value (attached or the next word);
 * `codeOperand` makes the first operand the code (sh -c); `stdin` letters read the program from stdin;
 * `digits` letters take only attached digits and `attached` letters take the rest of the word (perl -0777, -i.bak).
 * `wholeWords` specs never cluster letters, so every option is looked up in the `long*` lists.
 */
const define = (fields) => ({
  code: '',
  module: '',
  script: '',
  value: '',
  stdin: '',
  digits: '',
  attached: '',
  codeOperand: '',
  longCode: [],
  longScript: [],
  longValue: [],
  longStdin: [],
  ...fields,
});

const SPECS = [
  [
    new RegExp(`^(?:${shellNames().join('|')})$`),
    define({
      language: 'shell',
      codeOperand: 'c',
      value: SHELL_SHORT_VALUES,
      longValue: SHELL_LONG_VALUES,
      stdin: 's',
      plusOptions: true,
    }),
  ],
  [
    /^python[\d.]*$/,
    define({ language: 'python', code: 'c', module: 'm', value: 'WX', stdin: 'i', stops: true }),
  ],
  [
    /^(?:node|nodejs)$/,
    define({
      language: 'node',
      wholeWords: true,
      longCode: ['-e', '-p', '-pe', '--eval', '--print'],
      longStdin: ['-i', '--interactive'],
      longValue: ['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions'],
    }),
  ],
  [/^perl[\d.]*$/, define({ language: 'perl', code: 'eE', value: 'I', digits: '0l', attached: 'ixdDCFMmV' })],
  [/^ruby[\d.]*$/, define({ language: 'ruby', code: 'e', value: 'rICE', digits: '0', attached: 'xFiKTW' })],
  [
    /^php[\d.]*$/,
    define({ language: 'php', code: 'rBRE', script: 'fF', value: 'cdz', stdin: 'a', dashesEnd: true }),
  ],
  [/^osascript$/, define({ language: 'applescript', code: 'e', value: 'ls', stdin: 'i' })],
  [/^(?:tclsh|wish)[\d.]*$/, define({ language: 'tcl', wholeWords: true, longValue: ['-encoding'] })],
  [
    /^[gmn]?awk$/,
    define({
      language: 'awk',
      code: 'e',
      script: 'fEi',
      value: 'vFl',
      programOperand: true,
      longCode: ['--source'],
    }),
  ],
  [/^eval$/, define({ language: 'shell', allCode: true })],
  [/^(?:source|\.)$/, define({ language: 'shell', wholeWords: true, noStdin: true })],
];
const LETTER_ROLES = ['code', 'module', 'script', 'value'];
const WORD_ROLES = [
  ['code', 'longCode'],
  ['script', 'longScript'],
  ['value', 'longValue'],
];
const LEADING_DIGITS = /^(?:x[\da-fA-F]*|[0-7]*)/;

const isOption = (arg, spec) =>
  arg.length > 1 && (arg[0] === '-' || (spec.plusOptions === true && arg[0] === '+'));
const attachedValue = (text, at) => ({ value: { text, at }, width: 1 });
const nextValue = (args, index) => ({ value: { text: args[index + 1], at: index + 1 }, width: 2 });

function record(found, role, value, spec) {
  if (value.text === undefined || role === 'value') return;
  ({ code: found.codes, module: found.modules, script: found.scripts })[role].push(value);
  if (spec.stops && role !== 'script') found.stopped = true;
}

function readWordOption(args, index, spec, found) {
  const arg = args[index];
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg : arg.slice(0, equals);
  if (spec.longStdin.includes(name)) found.stdin = true;
  const role = WORD_ROLES.find(([, list]) => spec[list].includes(name))?.[0];
  if (!role) return 1;
  const { value, width } =
    equals === -1 ? nextValue(args, index) : attachedValue(arg.slice(equals + 1), index);
  record(found, role, value, spec);
  return width;
}

function readCluster(args, index, spec, found) {
  const arg = args[index];
  for (let at = 1; at < arg.length; at += 1) {
    const letter = arg[at];
    const role = LETTER_ROLES.find((name) => spec[name].includes(letter));
    if (letter === spec.codeOperand) found.wantsCode = true;
    else if (spec.stdin.includes(letter)) found.stdin = true;
    else if (spec.digits.includes(letter)) at += LEADING_DIGITS.exec(arg.slice(at + 1))[0].length;
    else if (spec.attached.includes(letter)) return 1;
    else if (role) {
      const rest = arg.slice(at + 1);
      const { value, width } = rest ? attachedValue(rest, index) : nextValue(args, index);
      record(found, role, value, spec);
      return width;
    }
  }
  return 1;
}

function readOption(args, index, spec, found) {
  const read = spec.wholeWords || args[index].startsWith('--') ? readWordOption : readCluster;
  return read(args, index, spec, found);
}

// Options end at the first operand, `-` (the program is stdin) or `--`; python's -c and -m end them too.
function readOptions(args, spec, found) {
  let index = 0;
  while (index < args.length && !found.stopped) {
    const arg = args[index];
    if (arg === '-') {
      found.stdin = true;
      return args.length;
    }
    if (arg === '--') return spec.dashesEnd ? args.length : index + 1;
    if (!isOption(arg, spec)) return index;
    index += readOption(args, index, spec, found);
  }
  return found.stopped ? args.length : index;
}

function takeOperand(args, index, spec, found) {
  const operand = index < args.length ? { text: args[index], at: index } : null;
  const hasProgram = found.codes.length + found.modules.length + found.scripts.length > 0;
  if (found.wantsCode || (spec.programOperand && !hasProgram)) {
    if (operand) found.codes.push(operand);
  } else if (!hasProgram) {
    if (operand) found.scripts.push(operand);
    else found.stdin ||= !spec.noStdin;
  }
}

function readArguments(args, spec) {
  const found = { codes: [], modules: [], scripts: [], stdin: false, wantsCode: false, stopped: false };
  if (spec.allCode) return { ...found, codes: args.map((text, at) => ({ text, at })) };
  takeOperand(args, readOptions(args, spec, found), spec, found);
  return found;
}

// Anything under /dev or /proc may be stdin: /dev/fd/0, /dev//stdin, /dev/./stdin, /proc/self/fd/0.
function isStdinPath(path) {
  const segments = [];
  for (const part of path.split('/')) {
    if (part === '..') segments.pop();
    else if (part !== '' && part !== '.') segments.push(part);
  }
  const anchored = path.startsWith('/') || path.split('/').includes('..');
  return anchored && ['dev', 'proc'].includes(segments[0] ?? '');
}

function summarize(found, spec, { expands, wrappers }) {
  const expanding = ({ at }) => expands[at] ?? true;
  const literalScripts = found.scripts.filter((script) => !expanding(script));
  const kinds = [
    ...found.codes.map((code) => classifyCode(spec.language, code.text, expanding(code))),
    ...found.modules.map((module) => classifyModule(module.text, expanding(module))),
  ];
  // xargs appends words read from stdin, which become the code or the script when none is given literally.
  const fromXargs = wrappers.includes('xargs') && found.scripts.length === 0;
  return {
    stdin: found.stdin || fromXargs || literalScripts.some((script) => isStdinPath(script.text)),
    unknownScript: found.scripts.some((script) => expanding(script) || !/[./]/.test(script.text)),
    expandedScript: found.scripts.some(expanding),
    scripts: literalScripts.map((script) => script.text),
    kinds,
  };
}

/**
 * Reads an interpreter's arguments in order with its option spec. Returns null for other programs, else
 * `stdin` (it runs code read from stdin), `unknownScript` (an expansion or bare word names its script),
 * `expandedScript` (an expansion names it), `scripts` (literal script paths) and `kinds` (each inline code or
 * module, classified by inline-code.mjs). A program named by an expansion could be any interpreter, so it
 * counts as reading stdin.
 */
export function readInterpreter(command) {
  if (command.dynamicProgram) {
    return { stdin: true, unknownScript: false, expandedScript: false, scripts: [], kinds: [] };
  }
  const spec = SPECS.find(([pattern]) => pattern.test(command.program))?.[1];
  return spec ? summarize(readArguments(command.args, spec), spec, command) : null;
}
