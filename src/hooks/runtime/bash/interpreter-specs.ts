import { SHELL_VALUE_OPTIONS, shellNames } from '../shell/syntax.js';

/**
 * How an interpreter reads its arguments.
 * - language: picks the inline-code allowlist (inline-code.ts).
 * - code, module, script, value: letters whose option takes a value, attached or the next word: inline code, a
 *   module to run, the script file, or a value that is none of these. long*: the same for whole words.
 * - stdin, longStdin: options that read the program from stdin (bash -s, python -i, node -i).
 * - codeOperand: the letter that makes the first operand the code (sh -c).
 * - digits: letters that take only attached digits (perl -0777); attached: letters that take the rest of the word.
 * - wholeWords: options never cluster letters (node, tclsh); plusOptions: `+o` options exist (shells).
 * - stops: -c and -m end the options (python); dashesEnd: after `--` the script is stdin (php).
 * - programOperand: the first operand is program text (awk); allCode: every argument is code (eval);
 *   noStdin: with no operand it reads nothing (source).
 */
export interface InterpreterSpec {
  readonly language: string;
  readonly code: string;
  readonly module: string;
  readonly script: string;
  readonly value: string;
  readonly longCode: readonly string[];
  readonly longScript: readonly string[];
  readonly longValue: readonly string[];
  readonly stdin: string;
  readonly longStdin: readonly string[];
  readonly codeOperand: string;
  readonly digits: string;
  readonly attached: string;
  readonly wholeWords: boolean;
  readonly plusOptions: boolean;
  readonly stops: boolean;
  readonly dashesEnd: boolean;
  readonly programOperand: boolean;
  readonly allCode: boolean;
  readonly noStdin: boolean;
}

const define = (fields: Partial<InterpreterSpec>): InterpreterSpec => ({
  language: '',
  code: '',
  module: '',
  script: '',
  value: '',
  longCode: [],
  longScript: [],
  longValue: [],
  stdin: '',
  longStdin: [],
  codeOperand: '',
  digits: '',
  attached: '',
  wholeWords: false,
  plusOptions: false,
  stops: false,
  dashesEnd: false,
  programOperand: false,
  allCode: false,
  noStdin: false,
  ...fields,
});

const SHELL_SHORT_VALUES = SHELL_VALUE_OPTIONS.filter((option) => option.length === 2)
  .map((option) => option[1])
  .join('');
const SHELL_LONG_VALUES = SHELL_VALUE_OPTIONS.filter((option) => option.startsWith('--'));

/** Every interpreter the guard reads, by a pattern over the program name. */
export const INTERPRETERS: readonly (readonly [RegExp, InterpreterSpec])[] = [
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
      longScript: ['--file', '--exec', '--include'],
      longValue: ['--assign', '--field-separator', '--load'],
    }),
  ],
  [/^eval$/, define({ language: 'shell', allCode: true })],
  [/^(?:source|\.)$/, define({ language: 'shell', wholeWords: true, noStdin: true })],
];
