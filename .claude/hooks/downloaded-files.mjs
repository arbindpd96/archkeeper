import { hasLong, parseOptions } from './cli-options.mjs';

const CURL = {
  values: {
    short: 'AbcCdDeEFHKmoPQrtTuUwxXyYz',
    long: ['--output', '--header', '--data', '--user', '--request', '--user-agent', '--referer', '--cookie'],
  },
  output: ['-o', '--output'],
  savesUnderUrlName: (options) => options.short.has('O') || hasLong(options, '--remote-name', 10),
};
const WGET = {
  values: {
    short: 'OoaPUtTweiBlARDIXQ',
    long: ['--output-document', '--output-file', '--directory-prefix', '--user-agent', '--header', '--tries'],
  },
  output: ['-O', '--output-document'],
  savesUnderUrlName: (_options, named) => named.length === 0,
};
const DOWNLOADERS = new Map([
  ['curl', CURL],
  ['wget', WGET],
]);

const baseName = (path) => path.slice(path.lastIndexOf('/') + 1).toLowerCase();
const urlName = (url) => baseName(url.split(/[?#]/)[0]);

function savedNames({ args, redirects }, downloader) {
  const options = parseOptions(args, downloader.values);
  const named = options.values.filter(([name]) => downloader.output.includes(name)).map(([, file]) => file);
  const fromUrls = downloader.savesUnderUrlName(options, named) ? options.operands.map(urlName) : [];
  return [...named.map(baseName), ...fromUrls, ...redirects.map(baseName)];
}

/**
 * Returns a test for whether a path names a file curl or wget writes in this command: a `-o`/`-O` target, a
 * name taken from the URL (curl -O, wget's default) or a redirect target. Only file names are compared, so
 * `sh ./i.sh` matches `curl -o /tmp/i.sh`, and case is ignored as on macOS.
 */
export function downloadedFiles(commands) {
  const names = new Set(
    commands
      .filter((command) => DOWNLOADERS.has(command.program))
      .flatMap((command) => savedNames(command, DOWNLOADERS.get(command.program)))
      .filter((name) => name !== '' && name !== '-'),
  );
  return (path) => names.has(baseName(path));
}
