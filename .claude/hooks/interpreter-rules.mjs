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

// A downloader can hide behind a variable (`"$D" url`) or a function defined in the same command.
function possibleDownload(commands) {
  const functions = new Set(
    commands.filter((command) => command.definesFunction).map(({ program }) => program),
  );
  return ({ program, dynamicProgram, definesFunction }) =>
    !definesFunction && (DOWNLOADERS.has(program) || dynamicProgram || functions.has(program));
}

function fedBy(commands, isSource) {
  const earliest = new Map();
  for (const { pipeline, stage } of commands.filter(isSource).flatMap((command) => command.pipes)) {
    earliest.set(pipeline, Math.min(stage, earliest.get(pipeline) ?? Infinity));
  }
  return ({ pipes }) => pipes.some(({ pipeline, stage }) => (earliest.get(pipeline) ?? Infinity) < stage);
}

function downloadVerdict({ stdin, unknownScript, kinds }, { piped, captured }) {
  const unknown = unknownScript || kinds.includes('unknown');
  if (piped && (stdin || unknown || kinds.includes('runs'))) return PIPE_TO_SHELL;
  if (captured && unknown) return PIPE_TO_SHELL;
  return piped && kinds.includes('opaque') ? DOWNLOAD_INTO_CODE : null;
}

const verdictFor = (interpreter, source) =>
  downloadVerdict(interpreter, source) ?? (interpreter.kinds.includes('unknown') ? UNCHECKED_CODE : null);

/**
 * Judges what interpreters run. Code from a download is denied when it is the program itself, built from an
 * expansion (`c=$(curl …); sh -c "$c"`), or able to run its input; other inline code a download feeds asks.
 * Inline code built from an expansion asks even without a download.
 */
export function interpreterVerdict(commands) {
  const isDownload = possibleDownload(commands);
  const piped = fedBy(commands, isDownload);
  const captured = commands.some((command) => command.subs.some(isDownload));
  return strictest(
    commands.map((command) => {
      const interpreter = readInterpreter(command);
      if (interpreter === null) return null;
      if (command.subs.some(isDownload)) return PIPE_TO_SHELL;
      return verdictFor(interpreter, { piped: piped(command), captured });
    }),
  );
}
