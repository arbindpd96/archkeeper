import { readInterpreter } from './interpreters.mjs';
import { ask, deny, strictest } from './verdicts.mjs';

const PIPE_TO_SHELL = deny('Piping a download into a shell is blocked. Download, review, then run.');
const DOWNLOAD_INTO_CODE = ask(
  'Downloaded data is piped into inline code that might run it. Confirm with the user.',
);
const UNCHECKED_CODE = ask(
  'A variable or command output supplies the code an interpreter runs. Confirm with the user.',
);

const DOWNLOADERS = new Set(['curl', 'wget']);
const isDownload = (command) => DOWNLOADERS.has(command.program);

function fedBy(commands, isSource) {
  const earliest = new Map();
  for (const { pipeline, stage } of commands.filter(isSource).flatMap((command) => command.pipes)) {
    earliest.set(pipeline, Math.min(stage, earliest.get(pipeline) ?? Infinity));
  }
  return ({ pipes }) => pipes.some(({ pipeline, stage }) => (earliest.get(pipeline) ?? Infinity) < stage);
}

function verdictFor({ stdin, unknownScript, kinds }, fed) {
  const runsInput = stdin || unknownScript || kinds.includes('unknown') || kinds.includes('runs');
  if (fed && runsInput) return PIPE_TO_SHELL;
  if (fed && kinds.includes('opaque')) return DOWNLOAD_INTO_CODE;
  return kinds.includes('unknown') ? UNCHECKED_CODE : null;
}

/**
 * Judges what interpreters run. Code read from a download (through a pipe or a substitution) is denied when it
 * is the program itself, built from an expansion, or able to run its input; other inline code it feeds asks.
 * Inline code built from an expansion asks even without a download.
 */
export function interpreterVerdict(commands) {
  const fed = fedBy(commands, isDownload);
  return strictest(
    commands.map((command) => {
      const interpreter = readInterpreter(command);
      if (interpreter === null) return null;
      if (command.subs.some(isDownload)) return PIPE_TO_SHELL;
      return verdictFor(interpreter, fed(command));
    }),
  );
}
