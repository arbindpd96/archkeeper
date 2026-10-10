import { styleText } from 'node:util';
import { ArchkeeperError } from '../core/errors.js';
import { escapeUnprintable } from '../core/text.js';

/** A `node:util` styleText format, such as `red` or `['bold', 'green']`. */
export type StyleFormat = Parameters<typeof styleText>[0];

/** Which output stream a text is for. */
export type Stream = 'stdout' | 'stderr';

/** Where the CLI writes; tests pass collectors instead of the process streams. */
export interface CliOutput {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Styles text for a stream, or returns it plain; without it the CLI prints no colour. */
  readonly style?: (format: StyleFormat, text: string, stream: Stream) => string;
}

/**
 * The process streams, styled by `node:util` styleText, which leaves out colour when a stream is not a terminal
 * and honours NO_COLOR and FORCE_COLOR (#26).
 */
export const PROCESS_OUTPUT: CliOutput = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  style: (format, text, stream) => styleText(format, text, { stream: process[stream] }),
};

/** Styles `text` for `stream` when the output can, else returns it as is. */
export function styled(
  output: CliOutput,
  format: StyleFormat,
  text: string,
  stream: Stream = 'stdout',
): string {
  return output.style === undefined ? text : output.style(format, text, stream);
}

function problemAndHint(error: ArchkeeperError): [string, string] {
  const split = error.message.indexOf('\nTry: ');
  if (split === -1) return [error.message, error.hint];
  return [error.message.slice(0, split), error.message.slice(split + '\nTry: '.length)];
}

function unexpected(error: unknown): [string, string] {
  const message = error instanceof Error ? error.message : String(error);
  return [`unexpected error: ${message}`, 'run again with --debug to see where it failed'];
}

/**
 * Prints an error on stderr (#26): an ArchkeeperError as its one line and a `Try:` line, anything else as one line
 * that says to run again with --debug. The stack trace follows only with `debug`. Every line is escaped, since a
 * message can echo a path or key read from a file.
 */
export function printError(output: CliOutput, error: unknown, debug: boolean): void {
  const [problem, hint] = error instanceof ArchkeeperError ? problemAndHint(error) : unexpected(error);
  const label = styled(output, ['bold', 'red'], 'Error:', 'stderr');
  output.stderr(`${label} ${escapeUnprintable(problem)}\nTry: ${escapeUnprintable(hint)}\n`);
  if (debug && error instanceof Error && error.stack !== undefined) {
    output.stderr(`${error.stack.split('\n').map(escapeUnprintable).join('\n')}\n`);
  }
}
