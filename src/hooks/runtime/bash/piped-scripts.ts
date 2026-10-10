import { decodeEscapes } from '../shell/ansi-c-quote.js';
import type { Command } from '../shell/commands.js';
import type { PipePosition } from '../shell/types.js';
import { type InterpreterRun, readInterpreter } from './interpreters.js';
import { ask, strictest, type Verdict } from './verdicts.js';

/** Verdict for text piped into a shell that the guard cannot read in full. */
export const PIPED_SCRIPT = ask(
  'This pipes generated text into a shell, so it cannot be checked. Confirm with the user.',
);

const ECHO_OPTION = /^-[neE]+$/;
const HIDDEN: Printed = { texts: [], escaped: true };

interface Printed {
  readonly texts: readonly string[];
  readonly escaped: boolean;
}

type JudgeScript = (script: string) => Verdict | null;

/**
 * How a command reads its program from text another command makes: as shell code the guard can judge, as code in
 * another language it can only see is hidden, or not at all. A program named by an expansion may be a shell.
 */
type Feed = 'shell' | 'code' | null;

function feedOf(run: InterpreterRun): Feed {
  if (run.language === 'shell') return run.stdin || run.unknownScript ? 'shell' : null;
  return run.stdin ? 'code' : null;
}

const producersOf = (commands: readonly Command[], { pipeline, stage }: PipePosition): Command[] =>
  commands.filter((command) =>
    command.pipes.some((pipe) => pipe.pipeline === pipeline && pipe.stage === stage - 1),
  );

// Escapes can spell a command the raw text hides (printf '\162m'), so the decoded text is judged as well.
function printfScript(args: readonly string[]): Printed {
  const text = args.join(' ');
  const escaped = /[\\%]/.test(text);
  return { texts: escaped ? [text, decodeEscapes(text)] : [text], escaped };
}

function echoScript(args: readonly string[]): Printed {
  const firstText = args.findIndex((arg) => !ECHO_OPTION.test(arg));
  const optionCount = firstText === -1 ? args.length : firstText;
  const text = args.slice(optionCount).join(' ');
  const escaped = optionCount > 0 || text.includes('\\');
  // echo -e and dash spell the octal escape \NNN as \0NNN.
  const decoded = decodeEscapes(text.replace(/\\0([0-7]{1,3})/g, '\\$1'));
  return { texts: escaped ? [text, decoded] : [text], escaped };
}

// echo and printf print their arguments and never read stdin; only a plain `cat` copies a here-document as it is.
// Any other program, such as base64 -d, xxd -r, tr, rev or openssl, transforms what it reads, so its text is hidden.
function printedScript(producer: Command): Printed {
  if (producer.program === 'printf') return printfScript(producer.args);
  if (producer.program === 'echo') return echoScript(producer.args);
  const copiesHeredoc = producer.program === 'cat' && producer.args.every((arg) => arg === '-');
  return copiesHeredoc && producer.heredocs.length > 0
    ? { texts: producer.heredocs, escaped: false }
    : HIDDEN;
}

// Only one plain echo, printf or here-document can be read in full; several producers or expansions hide text.
function feedVerdict(producers: readonly Command[], judgeScript: JudgeScript | null): Verdict | null {
  const scripts = producers.map(printedScript);
  const expanded = producers.some((producer) => producer.subs.length > 0 || producer.expands.some(Boolean));
  const hidden = producers.length !== 1 || expanded || scripts.some((script) => script.escaped);
  const verdicts = judgeScript === null ? [] : scripts.flatMap((script) => script.texts.map(judgeScript));
  return strictest([...verdicts, hidden ? PIPED_SCRIPT : null]);
}

// A here-document or here-string a reader takes as its program: shell code is judged, and other code built from a
// substitution is hidden. `sh < <(…)` and `bash <(…)` run what another command prints, which is hidden too.
function ownInputVerdict(command: Command, run: InterpreterRun, judgeScript: JudgeScript): Verdict | null {
  const feed = feedOf(run);
  const fromSubstitution = feed !== null && command.redirects.some((target) => target.startsWith('<('));
  if (run.substitutedScript || fromSubstitution) return PIPED_SCRIPT;
  if (feed === 'shell') return strictest(command.heredocs.map(judgeScript));
  return feed === 'code' && command.heredocs.length > 0 && command.subs.length > 0 ? PIPED_SCRIPT : null;
}

function readerVerdict(
  command: Command,
  commands: readonly Command[],
  judgeScript: JudgeScript,
): Verdict | null {
  const run = readInterpreter(command);
  if (run === null) return null;
  const feed = feedOf(run);
  const judge = feed === 'shell' ? judgeScript : null;
  const piped = command.pipes
    .filter((pipe) => feed !== null && pipe.stage > 0)
    .map((pipe) => feedVerdict(producersOf(commands, pipe), judge));
  return strictest([...piped, ownInputVerdict(command, run, judgeScript)]);
}

/**
 * Judges what a shell or interpreter reads as its program from a pipe, a here-document or a process substitution:
 * shell text from one plain echo, printf or `cat <<EOF` is judged with `judgeScript`, and the command asks when
 * several producers, an expansion, an escape or a transforming program such as `base64 -d` may change that text.
 */
export function pipedScriptVerdict(commands: readonly Command[], judgeScript: JudgeScript): Verdict | null {
  return strictest(commands.map((command) => readerVerdict(command, commands, judgeScript)));
}
