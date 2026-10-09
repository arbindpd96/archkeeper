#!/usr/bin/env node
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { exitWith } from './lib.mjs';

const MAX_BYTES = 2_000_000;
const MAX_SECONDS = { hero: 30, feature: 20 };
const HERO = /^#\s*hero\s*$/m;
const USAGE = 'Usage: node scripts/check-demos.mjs [<gif-dir>] [--tapes <dir>]';

const GIF_TRAILER = 0x3b;
const GIF_EXTENSION = 0x21;
const GIF_IMAGE = 0x2c;
const GRAPHIC_CONTROL = 0xf9;
const HAS_COLOR_TABLE = 0x80;

/** Reads the command line: the GIF folder (default docs/media) and the tape folder. */
function readOptions() {
  try {
    const { values, positionals } = parseArgs({
      options: { tapes: { type: 'string', default: 'docs/media/tapes' } },
      allowPositionals: true,
    });
    if (positionals.length > 1) throw new Error('more than one GIF folder');
    return { gifs: positionals[0] ?? 'docs/media', tapes: values.tapes };
  } catch (error) {
    return exitWith(`check-demos: ${error.message}\n${USAGE}`, 2);
  }
}

/** Returns the offset just past a chain of GIF data sub-blocks. */
function skipSubBlocks(gif, offset) {
  let at = offset;
  while (at < gif.length && gif[at] !== 0) at += gif[at] + 1;
  return at + 1;
}

/** Returns the size in bytes of a color table announced by a packed-flags byte. */
const colorTableBytes = (flags) => ((flags & HAS_COLOR_TABLE) === 0 ? 0 : 3 * 2 ** ((flags & 0x07) + 1));

/** Sums a GIF's frame delays in seconds, walking its blocks; throws on a file that is not a whole GIF. */
function gifSeconds(gif) {
  if (!/^GIF8[79]a$/.test(gif.toString('latin1', 0, 6))) throw new Error('it has no GIF header');
  let offset = 13 + colorTableBytes(gif[10]);
  let centiseconds = 0;
  while (offset < gif.length) {
    const block = gif[offset];
    if (block === GIF_TRAILER) return centiseconds / 100;
    if (block === GIF_EXTENSION) {
      if (gif[offset + 1] === GRAPHIC_CONTROL) centiseconds += gif.readUInt16LE(offset + 4);
      offset = skipSubBlocks(gif, offset + 2);
    } else if (block === GIF_IMAGE) {
      offset = skipSubBlocks(gif, offset + 11 + colorTableBytes(gif[offset + 9]));
    } else {
      throw new Error(`it has an unknown block 0x${block.toString(16)} at byte ${String(offset)}`);
    }
  }
  throw new Error('it ends before the GIF trailer');
}

/** Checks one GIF against its tape and the caps, returning a summary row and any problems. */
function checkGif(file, tapes) {
  const name = path.basename(file, '.gif');
  const tape = path.join(tapes, `${name}.tape`);
  const bytes = statSync(file).size;
  const hasTape = existsSync(tape);
  const kind = hasTape && HERO.test(readFileSync(tape, 'utf8')) ? 'hero' : 'feature';
  const problems = [];
  if (!hasTape) problems.push(`${name}.gif has no tape at ${tape}; GIFs are rendered from tapes.`);
  if (bytes > MAX_BYTES) problems.push(`${name}.gif is ${String(bytes)} bytes, over ${String(MAX_BYTES)}.`);
  let seconds;
  try {
    seconds = gifSeconds(readFileSync(file));
  } catch (error) {
    problems.push(`${name}.gif is not a valid GIF: ${error.message}.`);
  }
  if (seconds > MAX_SECONDS[kind]) {
    problems.push(
      `${name}.gif runs ${seconds.toFixed(1)} s, over the ${String(MAX_SECONDS[kind])} s ${kind} cap.`,
    );
  }
  const duration = seconds === undefined ? '?' : `${seconds.toFixed(1)} s`;
  return { row: [name, kind, `${(bytes / 1_000_000).toFixed(2)} MB`, duration], problems };
}

/** Prints the GIF table, and appends it to the GitHub job summary when one is available. */
function report(rows) {
  const table = ['| GIF | Kind | Size | Duration |', '| --- | --- | --- | --- |'];
  table.push(...rows.map((row) => `| ${row.join(' | ')} |`));
  process.stdout.write(`${table.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Demo GIFs\n\n${table.join('\n')}\n`);
  }
}

const options = readOptions();
const gifs = existsSync(options.gifs)
  ? readdirSync(options.gifs)
      .filter((file) => file.endsWith('.gif'))
      .sort()
  : [];
if (gifs.length === 0) {
  process.stdout.write(`check-demos: no GIFs in ${options.gifs}.\n`);
  process.exit(0);
}
const results = gifs.map((file) => checkGif(path.join(options.gifs, file), options.tapes));
report(results.map((result) => result.row));
const problems = results.flatMap((result) => result.problems);
if (problems.length > 0) {
  exitWith(`Demo check failed (2 MB; hero 30 s, feature 20 s):\n${problems.join('\n')}`, 1);
}
