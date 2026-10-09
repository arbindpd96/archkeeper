import { downloadedFiles, isDownloader } from './downloaded-files.mjs';
import { readInterpreter } from './interpreters.mjs';
import { ask, deny, strictest } from './verdicts.mjs';

const PIPE_TO_SHELL = deny('Piping a download into a shell is blocked. Download, review, then run.');
const RUN_DOWNLOADED = deny(
  'Running a file downloaded in the same command is blocked. Download, review, then run.',
);
const DOWNLOAD_INTO_CODE = ask(
  'Downloaded data is piped into inline code that might run it. Confirm with the user.',
);
const MAYBE_DOWNLOAD = ask(
  'A program named by a variable or a function feeds code to an interpreter, and it may download that code. Confirm with the user.',
);
const UNCHECKED_CODE = ask(
  'A variable or command output supplies the code an interpreter runs. Confirm with the user.',
);

const isLiteralDownload = ({ program, definesFunction }) => !definesFunction && isDownloader(program);

// A program named by a variable (`"$D" url`) or a function defined in the same command could be a downloader.
function maybeDownload(commands) {
  const functions = new Set(
    commands.filter((command) => command.definesFunction).map(({ program }) => program),
  );
  return ({ program, dynamicProgram, definesFunction }) =>
    !definesFunction && (dynamicProgram || functions.has(program));
}

function fedBy(commands, isSource) {
  const earliest = new Map();
  for (const { pipeline, stage } of commands.filter(isSource).flatMap((command) => command.pipes)) {
    earliest.set(pipeline, Math.min(stage, earliest.get(pipeline) ?? Infinity));
  }
  return ({ pipes }) => pipes.some(({ pipeline, stage }) => (earliest.get(pipeline) ?? Infinity) < stage);
}

// Where a download can reach an interpreter: its stdin pipe, a variable the command line captured it in, or
// a substitution in the interpreter's own words, such as `python3 < <(curl …)`.
function downloadSources(commands, isSource) {
  const piped = fedBy(commands, isSource);
  const captured = commands.some((command) => command.subs.some(isSource));
  return (command) => ({ piped: piped(command), captured, inOwnWords: command.subs.some(isSource) });
}

// Data reaches code only through stdin or an expansion in the code, module or script; plain arguments stay data.
function runsDownload(interpreter, { piped, captured, inOwnWords }) {
  const { stdin, unknownScript, expandedScript, kinds } = interpreter;
  const expanded = expandedScript || kinds.includes('unknown');
  const fromPipe = stdin || unknownScript || expanded || kinds.includes('runs');
  return (piped && fromPipe) || (captured && expanded) || (inOwnWords && stdin);
}

function downloadVerdict(interpreter, source) {
  if (runsDownload(interpreter, source)) return PIPE_TO_SHELL;
  return source.piped && interpreter.kinds.includes('opaque') ? DOWNLOAD_INTO_CODE : null;
}

function verdictFor(interpreter, literal, maybe) {
  const fromDownload = downloadVerdict(interpreter, literal);
  if (fromDownload) return fromDownload;
  if (downloadVerdict(interpreter, maybe)) return MAYBE_DOWNLOAD;
  return interpreter.kinds.includes('unknown') ? UNCHECKED_CODE : null;
}

/**
 * Judges what interpreters run. Code from a curl or wget download is denied when it is the program itself,
 * a script the same command downloaded, built from an expansion (`c=$(curl …); sh -c "$c"`), or able to run
 * its input; other inline code a download feeds asks. The same flows from a program named by a variable or a
 * function ask, and inline code built from an expansion asks even without a download.
 */
export function interpreterVerdict(commands) {
  const literal = downloadSources(commands, isLiteralDownload);
  const maybe = downloadSources(commands, maybeDownload(commands));
  const isDownloadedFile = downloadedFiles(commands);
  return strictest(
    commands.map((command) => {
      const interpreter = readInterpreter(command);
      if (interpreter === null) return null;
      const stdinFile = interpreter.stdin && command.redirects.some(isDownloadedFile);
      if (stdinFile || interpreter.scripts.some(isDownloadedFile)) return RUN_DOWNLOADED;
      return verdictFor(interpreter, literal(command), maybe(command));
    }),
  );
}
