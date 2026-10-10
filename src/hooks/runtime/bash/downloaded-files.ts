import type { Command } from '../shell/commands.js';
import { hasLong, type OptionSpec, parseOptions, type ParsedOptions } from './cli-options.js';

interface Downloader {
  readonly values: OptionSpec;
  readonly output: readonly string[];
  readonly savesUnderUrlName: (options: ParsedOptions, named: readonly string[]) => boolean;
}

const CURL: Downloader = {
  values: {
    short: 'AbcCdDeEFHKmoPQrtTuUwxXyYz',
    long: ['--output', '--header', '--data', '--user', '--request', '--user-agent', '--referer', '--cookie'],
  },
  output: ['-o', '--output'],
  savesUnderUrlName: (options) =>
    options.short.has('O') || hasLong(options, '--remote-name', 10) || hasLong(options, '--remote-name-all'),
};
const WGET: Downloader = {
  values: {
    short: 'OoaPUtTweiBlARDIXQ',
    long: ['--output-document', '--output-file', '--directory-prefix', '--user-agent', '--header', '--tries'],
  },
  output: ['-O', '--output-document'],
  savesUnderUrlName: (_options, named) => named.length === 0,
};
const DOWNLOADERS: ReadonlyMap<string, Downloader> = new Map([
  ['curl', CURL],
  ['wget', WGET],
]);

/** Tells whether a program is a downloader (curl or wget). */
export function isDownloader(program: string): boolean {
  return DOWNLOADERS.has(program);
}

const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1).toLowerCase();
const urlName = (url: string): string => baseName(url.split(/[?#]/)[0] ?? '');

function savedNames({ args, redirects }: Command, downloader: Downloader): string[] {
  const options = parseOptions(args, downloader.values);
  const named = options.values.filter(([name]) => downloader.output.includes(name)).map(([, file]) => file);
  const fromUrls = downloader.savesUnderUrlName(options, named) ? options.operands.map(urlName) : [];
  return [...named.map(baseName), ...fromUrls, ...redirects.map(baseName)];
}

/**
 * A test for whether a path names a file curl or wget writes in these commands: a `-o`/`-O` target, a name taken
 * from the URL (curl -O, wget's default) or a redirect target. Only file names are compared, so `sh ./i.sh`
 * matches `curl -o /tmp/i.sh`, and case is ignored as on macOS.
 */
export function downloadedFiles(commands: readonly Command[]): (file: string) => boolean {
  const names = new Set(
    commands
      .flatMap((command) => {
        const downloader = DOWNLOADERS.get(command.program);
        return downloader === undefined ? [] : savedNames(command, downloader);
      })
      .filter((name) => name !== '' && name !== '-'),
  );
  return (file) => names.has(baseName(file));
}
