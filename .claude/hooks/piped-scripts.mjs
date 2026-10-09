import { decodeEscapes } from './ansi-c-quote.mjs';
import { readInterpreter } from './interpreters.mjs';
import { isShell } from './shell-syntax.mjs';
import { ask, strictest } from './verdicts.mjs';

/** Verdict for text piped into a shell that the guard cannot read in full. */
export const PIPED_SCRIPT = ask(
  'This pipes generated text into a shell, so it cannot be checked. Confirm with the user.',
);

const ECHO_OPTION = /^-[neE]+$/;

// A shell whose script is stdin, or a program named by an expansion (it may be a shell), runs what a pipe feeds it.
function readsPipedScript(command) {
  if (!command.dynamicProgram && !isShell(command.program)) return false;
  const { stdin, unknownScript } = readInterpreter(command);
  return stdin || unknownScript;
}

const sameStage = (pipe, pipeline, stage) => pipe.pipeline === pipeline && pipe.stage === stage;
const producersOf = (commands, { pipeline, stage }) =>
  commands.filter((command) => command.pipes.some((pipe) => sameStage(pipe, pipeline, stage - 1)));

// Escapes can spell a command the raw text hides (printf '\162m'), so the decoded text is judged as well.
function printfScript(args) {
  const text = args.join(' ');
  const escaped = /[\\%]/.test(text);
  return { texts: escaped ? [text, decodeEscapes(text)] : [text], escaped };
}

function echoScript(args) {
  const firstText = args.findIndex((arg) => !ECHO_OPTION.test(arg));
  const optionCount = firstText === -1 ? args.length : firstText;
  const text = args.slice(optionCount).join(' ');
  const escaped = optionCount > 0 || text.includes('\\');
  // echo -e and dash spell the octal escape \NNN as \0NNN.
  const decoded = decodeEscapes(text.replace(/\\0([0-7]{1,3})/g, '\\$1'));
  return { texts: escaped ? [text, decoded] : [text], escaped };
}

function printedScript(producer) {
  if (producer.heredocs.length > 0) return { texts: producer.heredocs, escaped: false };
  if (producer.program === 'printf') return printfScript(producer.args);
  if (producer.program === 'echo') return echoScript(producer.args);
  return { texts: [], escaped: true };
}

// Only one plain echo, printf or here-document can be read in full; several producers or expansions hide text.
function feedVerdict(producers, judgeScript) {
  const scripts = producers.map(printedScript);
  const expanded = producers.some((producer) => producer.subs.length > 0 || producer.expands.some(Boolean));
  const hidden = producers.length !== 1 || expanded || scripts.some((script) => script.escaped);
  const verdicts = scripts.flatMap((script) => script.texts.map(judgeScript));
  return strictest([...verdicts, hidden ? PIPED_SCRIPT : null]);
}

/**
 * Judges what a shell reads from a pipe: each producer's text is judged with `judgeScript` (text → verdict),
 * and the command asks when several producers, an expansion, an escape or a format may change that text.
 */
export function pipedScriptVerdict(commands, judgeScript) {
  const verdicts = commands
    .filter(readsPipedScript)
    .flatMap((shell) =>
      shell.pipes
        .filter((pipe) => pipe.stage > 0)
        .map((pipe) => feedVerdict(producersOf(commands, pipe), judgeScript)),
    );
  return strictest(verdicts);
}
